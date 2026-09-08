import { PackageRequestSchema, PACKAGE_HEADERS, PACKAGE_MAX_BYTES, type PackageRfq } from '../../shared/package-v2.js';
import {
  AcceptanceRequestSchema, BootstrapSchema, CONTRACT_VERSION, ExportRequestSchema,
  LengthMmSchema, RequirementsUpdateRequestSchema, RunRequestSchema, canonicalize, HANDLE_DATUM_CANONICAL_JSON,
  parseStrictJson, sha256, verifyCandidateEvidence, verifyRequirements,
  type AcceptanceRequest, type Artifact, type Bootstrap, type Candidate, type Event,
  type ExportRequest, type RequirementsUpdateRequest, type RunRequest, type Requirements,
} from '../../shared/contracts-v2.js';
import {
  ApiErrorResponseSchema, EventsResponseSchema, RequirementsMutationResponseSchema,
  RunMutationResponseSchema, verifyAcceptanceHistory, verifyAcceptanceResponse,
} from '../../shared/transport-v2.js';
import { ReferenceResponseSchema, type Reference, type ReferenceArtifact } from '../../shared/reference-v2.js';
import type { AcceptanceHistory } from '../../shared/state-v2.js';

type Pending =
  | { kind: 'requirements'; path: string; body: RequirementsUpdateRequest }
  | { kind: 'run'; path: string; body: RunRequest }
  | { kind: 'accept'; path: string; body: AcceptanceRequest }
  | { kind: 'export'; path: string; body: ExportRequest; artifactId: string; revisionId: string };
type Draft = { lengthMm: string; instruction: string };
type Download = { artifact: Artifact; bytes: ArrayBuffer };
type PrototypeDownload = { bytes: ArrayBuffer; fileName: string; sha256: string; revisionId: string; acceptanceId: string; manifestId: string; manifestHash: string };

class LiveError extends Error {
  constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message); }
}
const same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
const liveEvidence = (candidate: Candidate) => candidate.executionMode === 'live'
  && candidate.engine !== null && candidate.engine.name !== 'fixture'
  && candidate.checks.every(check => check.executionMode === 'live')
  && candidate.artifacts.every(artifact => artifact.executionMode === 'live');
const newId = () => `browser_${crypto.randomUUID()}`;
const safeMessage = (error: unknown) => error instanceof LiveError ? error.message
  : 'The response could not be verified. Refresh both state and history, then review before retrying.';

export function createLiveWorkspaceController({ fetch: fetcher }: { fetch: typeof globalThis.fetch }) {
  let bootstrap: Bootstrap | null = null;
  let history: AcceptanceHistory | null = null;
  let reference: Reference | null = null;
  let baselineBytes: ArrayBuffer | null = null;
  let activity: Event[] = [];
  let globalCursor = 0;
  let error: string | null = null;
  let draft: Draft = { lengthMm: '', instruction: '' };
  let draftEdited = false;
  let viewedRevisionId: string | null = null;
  let loading = false;
  let busy = false;
  let trusted = false;
  let generation = 0;
  let selection = 0;
  let pending: Pending | null = null;
  let confirmedRequirementsId: string | null = null;
  const subscribers = new Set<() => void>();
  const emit = () => { for (const subscriber of subscribers) subscriber(); };

  async function request(path: string, init?: RequestInit): Promise<Response> {
    if (!/^\/api\/[a-zA-Z0-9_/?=&.-]+$/.test(path)) throw new LiveError('Only registered same-origin API paths are supported.');
    let response: Response;
    try {
      response = await fetcher(path, { ...init, signal: AbortSignal.timeout(20_000), mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    } catch { throw new LiveError('Connection interrupted. Reconnect to reconcile state, then explicitly retry the pending action.', 0, true); }
    if (response.redirected) throw new LiveError('The API redirected. Restore access and reconnect; your draft is retained.', response.status, true);
    return response;
  }

  async function readBytes(response: Response, limit: number): Promise<ArrayBuffer> {
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
      await response.body?.cancel();
      throw new LiveError('The response exceeds its registered byte limit. Refresh to retry.');
    }
    if (!response.body) throw new LiveError('The response has no bytes. Reconnect to retry.', 0, true);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new LiveError('The response exceeds its registered byte limit. Refresh to retry.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  }

  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(path, init);
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      await response.body?.cancel();
      throw new LiveError(`Expected API JSON (HTTP ${response.status}). Restore API access and reconnect; your draft is retained.`, response.status, response.ok);
    }
    let value: unknown;
    try { value = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(response, 25 * 1024 * 1024))); }
    catch { throw new LiveError('The API returned unreadable JSON. Reconnect before retrying the pending action.', response.status, response.ok); }
    if (!response.ok) {
      const parsed = ApiErrorResponseSchema.safeParse(value);
      throw new LiveError(parsed.success ? `${parsed.data.error.message} (HTTP ${response.status})`
        : `API request failed (HTTP ${response.status}). Restore access and refresh.`, response.status, response.status >= 500);
    }
    return value;
  }

  async function artifactBytes(artifact: Artifact | ReferenceArtifact, currentExport = false, registeredReference = reference): Promise<ArrayBuffer> {
    const response = await request(artifact.href);
    if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== artifact.mediaType.toLowerCase()) {
      await response.body?.cancel();
      throw new LiveError(`Registered artifact unavailable or wrong media type (HTTP ${response.status}). Refresh and retry the download.`);
    }
    const applicability = response.headers.get('x-worldkinetics-applicability');
    const candidate = 'revisionId' in artifact;
    const identityMatches = candidate
      ? artifact.executionMode === 'live'
        && response.headers.get('x-worldkinetics-revision') === artifact.revisionId
        && response.headers.get('x-worldkinetics-execution') === artifact.executionMode
        && (applicability === 'current' || (!currentExport && applicability === 'historical'))
      : registeredReference !== null && response.headers.get('x-worldkinetics-revision') === registeredReference.revisionId
        && applicability === registeredReference.provenance;
    if (!identityMatches) {
      await response.body?.cancel();
      throw new LiveError('Artifact revision, execution or applicability does not match the registered request. No file was loaded. Refresh and retry.');
    }
    const bytes = await readBytes(response, artifact.bytes);
    const declaredBytes = response.headers.get('content-length');
    if ((declaredBytes !== null && Number(declaredBytes) !== artifact.bytes)
      || bytes.byteLength !== artifact.bytes || await sha256(new Uint8Array(bytes)) !== artifact.sha256) {
      throw new LiveError('Artifact byte count or SHA-256 mismatch. No file was loaded. Refresh and retry.');
    }
    return bytes;
  }

  function latestPair(b = bootstrap, h = history) {
    const latest = h?.acceptances.reduce<(AcceptanceHistory['acceptances'][number]) | null>(
      (previous, record) => !previous || record.stateVersion > previous.stateVersion ? record : previous, null);
    const manifest = latest && h?.manifests.find(item => item.acceptanceId === latest.acceptanceId);
    if (!b?.design || !b.requirements || !latest || !manifest) return null;
    if (latest.stateVersion > b.design.stateVersion || latest.candidate.designId !== b.design.designId
      || latest.candidate.revisionId !== b.design.acceptedRevisionId || !b.design.acceptedRequirementsMatch
      || !same(latest.requirements, b.requirements) || !same(manifest.requirements, b.requirements)
      || !liveEvidence(latest.candidate)) return null;
    return { acceptance: latest, manifest };
  }

  function reconciled(b: Bootstrap, h: AcceptanceHistory) {
    if (!b.design?.acceptedRevisionId) return h.acceptances.length === 0 && !b.design?.acceptedRequirementsMatch;
    const latest = [...h.acceptances].sort((a, z) => z.stateVersion - a.stateVersion)[0];
    if (!latest || latest.stateVersion > b.design.stateVersion || latest.candidate.designId !== b.design.designId
      || latest.candidate.revisionId !== b.design.acceptedRevisionId) return false;
    // A requirements change legitimately leaves historical acceptance in place, with export disabled.
    return !b.design.acceptedRequirementsMatch || same(latest.requirements, b.requirements);
  }

  function selectedCandidate() { return bootstrap?.candidates.find(item => item.revisionId === bootstrap?.design?.selectedCandidateRevisionId); }
  function initialAcceptance(requirements: Requirements, records = history) {
    if (requirements.registryId !== 'handle_sample_v1' || !requirements.setup.acceptedInitial) return null;
    const bound = requirements.setup.acceptedInitial;
    const accepted = records?.acceptances.find(item => item.acceptanceId === bound.acceptanceId);
    const candidate = accepted?.candidate;
    if (!accepted || !candidate || !liveEvidence(candidate) || candidate.requirements.registryId !== 'handle_sample_v1'
      || candidate.requirements.setupId !== 'handle_initial_v1' || candidate.designId !== requirements.designId
      || !same(candidate.requirements.setup.reference, requirements.setup.reference)
      || candidate.inputRevisionId !== requirements.setup.reference.revisionId || candidate.checks.length !== 8
      || candidate.checks.some(check => check.state !== 'passed')) return null;
    const step = candidate.artifacts.find(item => item.kind === 'export' && item.mediaType === 'model/step');
    if (!step || !same(bound, { acceptanceId: accepted.acceptanceId, revisionId: candidate.revisionId,
      artifactId: step.artifactId, sha256: step.sha256, requirementsId: candidate.requirementsId,
      requirementsVersion: candidate.requirementsVersion, setupHash: candidate.setupHash,
      sourceSha256: candidate.sourceSha256, checkBundleHash: candidate.checkBundleHash })) return null;
    return accepted;
  }
  function currentInitial() {
    const latest = history && [...history.acceptances].sort((a,b) => b.stateVersion-a.stateVersion)[0];
    const r = bootstrap?.requirements, candidate = latest?.candidate;
    return r?.registryId === 'handle_sample_v1' && candidate?.requirements.registryId === 'handle_sample_v1'
      && candidate.requirements.setupId === 'handle_initial_v1' && liveEvidence(candidate)
      && candidate.revisionId === bootstrap?.design?.acceptedRevisionId && candidate.designId === r.designId
      && candidate.inputRevisionId === r.setup.reference.revisionId && same(candidate.requirements.setup.reference, r.setup.reference)
      ? latest : null;
  }
  function gates() {
    const ready = trusted && !loading && !busy && !pending && !!bootstrap?.design && !!bootstrap.requirements;
    const requirements = bootstrap?.requirements;
    const numeric = requirements?.registryId === 'plate_requirements_v1' && requirements.setupId === 'resize_centered_v1';
    const handle = requirements?.registryId === 'handle_sample_v1';
    const length = draft.lengthMm.trim() === '' ? NaN : Number(draft.lengthMm);
    const validLength = LengthMmSchema.safeParse(length).success;
    const canRefine = Boolean(ready && handle && currentInitial() && !bootstrap?.design?.activeRunId);
    const canConfirm = Boolean(ready && !bootstrap?.design?.activeRunId && (numeric && validLength || handle && (requirements.setupId === 'handle_initial_v1'
      ? !bootstrap?.design?.acceptedRevisionId : canRefine)));
    const candidate = selectedCandidate();
    const canAccept = Boolean(ready && (numeric || handle) && candidate && candidate.revisionId === viewedRevisionId
      && candidate.status === 'reviewable' && candidate.revisionId !== bootstrap?.design?.acceptedRevisionId && liveEvidence(candidate)
      && same(candidate.requirements, bootstrap!.requirements));
    return {
      canConfirm, canRefine,
      canRun: Boolean(ready && requirements && confirmedRequirementsId === requirements.requirementsId
        && (numeric && validLength && length === requirements.setup.dimensions.lengthMm && !bootstrap!.design!.acceptedRevisionId
          || handle && (requirements.setupId === 'handle_initial_v1' ? !bootstrap!.design!.acceptedRevisionId
            : currentInitial()?.acceptanceId === requirements.setup.acceptedInitial?.acceptanceId && initialAcceptance(requirements)))
        && draft.instruction.trim().length > 0 && draft.instruction.trim().length <= 2000
        && bootstrap!.executionMode === 'live' && !bootstrap!.design!.activeRunId),
      canAccept,
      canDownload: Boolean(ready && latestPair()),
    };
  }

  async function refresh(reset = false, readReference = false): Promise<boolean> {
    const token = ++generation;
    loading = true; trusted = false; error = null;
    if (reset) { globalCursor = 0; activity = []; }
    emit();
    try {
      let nextReference = reference;
      let nextBytes = baselineBytes;
      if (readReference || !nextReference || !nextBytes) {
        nextReference = ReferenceResponseSchema.parse(await json('/api/reference')).reference;
        nextBytes = await artifactBytes(nextReference.artifacts.find(item => item.mediaType === 'model/stl')!, false, nextReference);
        if (nextReference.referenceId === 'handle_mount_v1') {
          const datum = await artifactBytes(nextReference.artifacts.find(item => item.mediaType === 'application/json')!, false, nextReference);
          if (new TextDecoder().decode(datum) !== HANDLE_DATUM_CANONICAL_JSON) throw new LiveError('The mounting reference could not be verified. Refresh before continuing.');
        }
      }
      const feed = EventsResponseSchema.parse(await json(`/api/events?after=${globalCursor}`));
      for (const event of feed.events) if (event.candidate) await verifyCandidateEvidence(event.candidate);
      if (token !== generation) return false;
      const observations = new Map(activity.map(event => [event.eventId, event]));
      let nextCursor = globalCursor;
      for (const event of feed.events) {
        if (observations.has(event.eventId) && !same(observations.get(event.eventId), event)) {
          throw new LiveError('Event identity changed. Use reconnect to restart the global feed.');
        }
        observations.set(event.eventId, event);
        nextCursor = Math.max(nextCursor, event.eventId);
      }
      globalCursor = nextCursor;
      activity = [...observations.values()].sort((a, b) => a.eventId - b.eventId);
      let nextBootstrap: Bootstrap | null = null;
      let nextHistory: AcceptanceHistory | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const [rawBootstrap, rawHistory] = await Promise.all([json('/api/bootstrap'), json('/api/acceptances')]);
        nextBootstrap = BootstrapSchema.parse(rawBootstrap);
        if (nextBootstrap.executionMode === 'fixture') throw new LiveError('The API returned fixture mode. Open Synthetic revision review for fixture evidence; live actions are unavailable.');
        if (nextBootstrap.requirements) await verifyRequirements(nextBootstrap.requirements);
        await Promise.all(nextBootstrap.candidates.map(verifyCandidateEvidence));
        nextHistory = await verifyAcceptanceHistory(rawHistory);
        if (token !== generation) return false;
        if (reconciled(nextBootstrap, nextHistory)) break;
        if (attempt === 1) throw new LiveError('Current state and acceptance history disagree. Refresh both before exporting.');
      }
      if (!nextBootstrap || !nextHistory || !nextReference || !nextBytes) throw new LiveError('Workspace evidence is incomplete. Reconnect to retry.');
      const { design, requirements } = nextBootstrap;
      if (requirements?.registryId === 'handle_sample_v1' && requirements.setupId === 'handle_refine_v1'
        && !initialAcceptance(requirements, nextHistory)) throw new LiveError('The starting design does not match its acceptance record. Refresh before refining.');
      if (design && requirements && (design.baselineRevisionId !== nextReference.revisionId
        || requirements.referenceId !== nextReference.referenceId
        || requirements.referenceHash !== nextReference.artifacts.find(item => item.mediaType === 'model/step')?.sha256)) {
        throw new LiveError('Baseline reference identity does not match the authoritative requirements. Reconnect before proceeding.');
      }
      if (token !== generation) return false;
      const previousSelection = bootstrap?.design?.selectedCandidateRevisionId;
      if (!viewedRevisionId || viewedRevisionId === previousSelection || !nextBootstrap.candidates.some(item => item.revisionId === viewedRevisionId)) {
        viewedRevisionId = design?.selectedCandidateRevisionId ?? null;
      }
      bootstrap = nextBootstrap; history = nextHistory; reference = nextReference; baselineBytes = nextBytes;
      if (!draftEdited && !draft.lengthMm && requirements?.registryId === 'plate_requirements_v1') draft = { ...draft, lengthMm: String(requirements.setup.dimensions.lengthMm) };
      trusted = true;
      return true;
    } catch (failure) {
      if (token === generation) { error = safeMessage(failure); trusted = false; }
      return false;
    } finally { if (token === generation) { loading = false; emit(); } }
  }

  async function execute(action: Pending): Promise<Download | null> {
    const raw = await json(action.path, { method: action.kind === 'requirements' ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(action.body) });
    if (action.kind === 'requirements') {
      const response = RequirementsMutationResponseSchema.parse(raw);
      const requirements = await verifyRequirements(response.requirements);
      if (requirements.designId !== bootstrap?.design?.designId
        || requirements.requirementsVersion !== action.body.expectedRequirementsVersion + 1
        || requirements.setupId !== action.body.setupId
        || (action.body.setupId === 'resize_centered_v1' && (requirements.registryId !== 'plate_requirements_v1'
          || requirements.setup.dimensions.lengthMm !== action.body.confirmedIntent.lengthMm))
        || (requirements.registryId === 'handle_sample_v1' && requirements.setupId === 'handle_refine_v1' && !initialAcceptance(requirements))
        || response.design.stateVersion !== action.body.expectedStateVersion + 1
        || response.design.activeRequirementsVersion !== requirements.requirementsVersion
        || response.design.designId !== requirements.designId || response.design.setupHash !== requirements.setupHash
        || response.design.setupId !== requirements.setupId || response.design.referenceId !== requirements.referenceId
        || response.design.referenceHash !== requirements.referenceHash || response.design.units !== requirements.units) {
        throw new LiveError('Requirements confirmation response does not match the original action. Reconcile before retrying.', 0, true);
      }
      confirmedRequirementsId = requirements.requirementsId;
    } else if (action.kind === 'run') {
      const { run } = RunMutationResponseSchema.parse(raw);
      for (const key of Object.keys(action.body) as (keyof RunRequest)[]) {
        if (run[key] !== action.body[key]) throw new LiveError('Run response does not match the original request. Reconcile before retrying.', 0, true);
      }
      if (run.executionMode !== 'live') throw new LiveError('The run did not return live evidence. Reconnect before retrying.', 0, true);
    } else if (action.kind === 'accept') {
      await verifyAcceptanceResponse(raw, action.body);
    } else {
      const response = await verifyAcceptanceResponse(raw);
      if (response.acceptance.acceptanceId !== action.body.acceptanceId || response.manifest.manifestId !== action.body.manifestId
        || response.manifest.manifestHash !== action.body.manifestHash || response.manifest.revisionId !== action.revisionId
        || response.acceptance.candidate.revisionId !== action.revisionId || !liveEvidence(response.acceptance.candidate)) {
        throw new LiveError('Export response does not match the requested acceptance and manifest. Refresh before another download.');
      }
      if (!await refresh()) throw new LiveError('Export could not reconcile current state. Reconnect before downloading.');
      const pair = latestPair();
      if (!pair || pair.acceptance.acceptanceId !== action.body.acceptanceId || pair.manifest.manifestHash !== action.body.manifestHash
        || pair.manifest.manifestId !== action.body.manifestId) throw new LiveError('Acceptance changed during export. Review the refreshed state and download again.');
      const artifact = response.manifest.artifacts.find(item => item.artifactId === action.artifactId);
      if (!artifact) throw new LiveError('Choose an artifact registered in the latest accepted manifest.');
      const token = generation;
      const bytes = await artifactBytes(artifact, true);
      if (token !== generation || !trusted) throw new LiveError('State changed while downloading. Review the current acceptance and retry.');
      return { artifact, bytes };
    }
    return null;
  }

  async function mutate(action: Pending): Promise<Download | null> {
    busy = true; pending = action; error = null;
    // Invalidate any older snapshot verification already in flight.
    generation++; loading = false; emit();
    try {
      const result = await execute(action);
      pending = null;
      if (action.kind !== 'export') await refresh();
      return result;
    } catch (failure) {
      const message = safeMessage(failure);
      const uncertain = !(failure instanceof LiveError) || failure.uncertain;
      if (!uncertain) pending = null;
      if (failure instanceof LiveError && failure.status === 409) await refresh();
      error = message;
      return null;
    } finally { busy = false; emit(); }
  }

  return {
    load: () => refresh(true, true),
    refresh: () => refresh(),
    async poll() {
      if (busy || loading || pending || error) return false;
      const token = generation;
      try {
        const feed = EventsResponseSchema.parse(await json(`/api/events?after=${globalCursor}`));
        if (token !== generation) return false;
        // Only the full refresh processes observations and advances the cursor.
        // Empty polls leave the inspected mesh and camera intact.
        return feed.events.length ? refresh() : true;
      } catch (failure) {
        if (token === generation) { generation++; trusted = false; error = safeMessage(failure); emit(); }
        return false;
      }
    },
    reconnect: () => refresh(true, true),
    setDraft(update: Partial<Draft>) { draftEdited = true; draft = { ...draft, ...update }; emit(); },
    selectRevision(revisionId: string) {
      selection++;
      viewedRevisionId = bootstrap?.candidates.some(item => item.revisionId === revisionId) ? revisionId : null;
      emit();
    },
    async confirmRequirements(setupId: RequirementsUpdateRequest['setupId'] = bootstrap?.requirements?.setupId ?? 'resize_centered_v1') {
      const r = bootstrap?.requirements, gate = gates();
      if (!r || (setupId === 'handle_refine_v1' ? !gate.canRefine : !gate.canConfirm || setupId !== r.setupId)) return;
      const body = RequirementsUpdateRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(), userActionId: newId(),
        expectedStateVersion: bootstrap!.design!.stateVersion, expectedRequirementsVersion: bootstrap!.requirements!.requirementsVersion,
        setupId, confirmedIntent: setupId === 'resize_centered_v1' ? { lengthMm: Number(draft.lengthMm) } : {} });
      await mutate({ kind: 'requirements', path: `/api/designs/${bootstrap!.design!.designId}/requirements`, body });
    },
    async requestRun() {
      if (!gates().canRun) return;
      const r = bootstrap!.requirements!;
      const body = RunRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(), designId: bootstrap!.design!.designId,
        inputRevisionId: r.registryId === 'handle_sample_v1' ? r.setup.acceptedInitial?.revisionId ?? r.setup.reference.revisionId : bootstrap!.design!.baselineRevisionId, requirementsVersion: r.requirementsVersion,
        setupId: bootstrap!.requirements!.setupId, units: bootstrap!.requirements!.units, instruction: draft.instruction.trim() });
      await mutate({ kind: 'run', path: '/api/runs', body });
    },
    async acceptRevision() {
      if (!gates().canAccept) return;
      const candidate = selectedCandidate()!;
      const body = AcceptanceRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(), userActionId: newId(),
        designId: candidate.designId, candidateRevisionId: candidate.revisionId, requirementsVersion: candidate.requirementsVersion,
        expectedStateVersion: bootstrap!.design!.stateVersion, expectedAcceptedRevisionId: bootstrap!.design!.acceptedRevisionId,
        registryHash: candidate.registryHash, setupHash: candidate.setupHash, geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash });
      await mutate({ kind: 'accept', path: `/api/revisions/${candidate.revisionId}/accept`, body });
    },
    async retryPending() {
      if (busy || !pending) return null;
      const action = pending;
      busy = true; emit();
      const ready = await refresh(true, true);
      if (!ready) { busy = false; emit(); return null; }
      return mutate(action);
    },
    canSavePackage(result: PrototypeDownload) {
      const pair = latestPair();
      return Boolean(gates().canDownload && pair && pair.manifest.revisionId === result.revisionId
        && pair.acceptance.acceptanceId === result.acceptanceId && pair.manifest.manifestId === result.manifestId
        && pair.manifest.manifestHash === result.manifestHash);
    },
    async downloadPackage(rfq: PackageRfq = {}): Promise<PrototypeDownload | null> {
      if (!gates().canDownload) return null;
      const pair = latestPair()!;
      const body = PackageRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(),
        acceptanceId: pair.acceptance.acceptanceId, manifestId: pair.manifest.manifestId,
        manifestHash: pair.manifest.manifestHash, rfq });
      const revisionId = pair.manifest.revisionId;
      const token = generation;
      busy = true; emit();
      try {
        const response = await request(`/api/revisions/${revisionId}/package`, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (response.status !== 200) {
          await response.body?.cancel();
          throw new LiveError(`Package unavailable (HTTP ${response.status}). Check status and try again. No file was downloaded.`);
        }
        const expected = { contractVersion: CONTRACT_VERSION, requestId: body.requestId, revisionId,
          acceptanceId: body.acceptanceId, manifestId: body.manifestId, manifestHash: body.manifestHash, applicability: 'current' };
        const fileName = `worldkinetics-${revisionId}-prototype.zip`;
        const disposition = response.headers.get('content-disposition');
        const declared = response.headers.get('content-length');
        const digest = response.headers.get(PACKAGE_HEADERS.sha256) ?? '';
        if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/zip'
          || !Object.entries(expected).every(([key, value]) => response.headers.get(PACKAGE_HEADERS[key as keyof typeof expected]) === value)
          || !declared || !/^[0-9]+$/.test(declared) || Number(declared) < 1 || Number(declared) > PACKAGE_MAX_BYTES
          || !/^[a-f0-9]{64}$/.test(digest)
          || (disposition !== `attachment; filename="${fileName}"` && disposition !== `attachment; filename=${fileName}`)) {
          await response.body?.cancel();
          throw new LiveError('Package identity or download headers did not match. No file was downloaded.');
        }
        const bytes = await readBytes(response, PACKAGE_MAX_BYTES);
        if (bytes.byteLength !== Number(declared) || await sha256(new Uint8Array(bytes)) !== digest) {
          throw new LiveError('Package size or checksum did not match. No file was downloaded.');
        }
        if (token !== generation || !trusted || error) throw new LiveError('Design state changed during download. Check status and try again.');
        if (!await refresh()) throw new LiveError('Could not confirm the accepted design. No file was downloaded.');
        const current = latestPair();
        if (!current || current.acceptance.acceptanceId !== body.acceptanceId || current.manifest.manifestId !== body.manifestId
          || current.manifest.manifestHash !== body.manifestHash || current.manifest.revisionId !== revisionId) {
          throw new LiveError('The accepted design changed. Download its new package instead.');
        }
        return { bytes, fileName, sha256: digest, revisionId, acceptanceId: body.acceptanceId,
          manifestId: body.manifestId, manifestHash: body.manifestHash };
      } finally { busy = false; emit(); }
    },
    async exportArtifact(artifactId: string) {
      if (!gates().canDownload) return null;
      const pair = latestPair()!;
      if (!pair.manifest.artifacts.some(item => item.artifactId === artifactId)) {
        error = 'Choose a file from the latest accepted manifest.'; emit(); return null;
      }
      const body = ExportRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(), acceptanceId: pair.acceptance.acceptanceId,
        manifestId: pair.manifest.manifestId, manifestHash: pair.manifest.manifestHash });
      return mutate({ kind: 'export', path: `/api/revisions/${pair.manifest.revisionId}/export`, body, artifactId, revisionId: pair.manifest.revisionId });
    },
    async preview(revisionId: string | null) {
      const token = generation, selected = selection;
      if (!trusted || loading) return null;
      try {
        if (revisionId === null) {
          const artifact = reference?.artifacts.find(item => item.mediaType === 'model/stl');
          return artifact && baselineBytes ? { artifact, bytes: baselineBytes.slice(0) } : null;
        }
        const r = bootstrap?.requirements;
        // Refinement comparison uses the immutable acceptance, even if historical bootstrap records change.
        const candidate = r?.registryId === 'handle_sample_v1' && r.setup.acceptedInitial?.revisionId === revisionId
          ? initialAcceptance(r)?.candidate : bootstrap?.candidates.find(item => item.revisionId === revisionId);
        const artifact = candidate?.artifacts.find(item => item.mediaType === 'model/stl');
        if (!candidate || !artifact || !liveEvidence(candidate)) throw new LiveError('This candidate has no registered live STL preview.');
        const bytes = await artifactBytes(artifact);
        if (token !== generation || selected !== selection || !trusted) return null;
        return { artifact, bytes };
      } catch (failure) {
        if (token === generation && selected === selection) { error = safeMessage(failure); emit(); }
        return null;
      }
    },
    snapshot() {
      return structuredClone({ bootstrap, history, reference, activity, globalCursor, error, draft, viewedRevisionId,
        loading, busy, trusted, pendingAction: pending?.kind ?? null, ...gates() });
    },
    subscribe(subscriber: () => void) { subscribers.add(subscriber); return () => { subscribers.delete(subscriber); }; },
  };
}
export type LiveWorkspaceController = ReturnType<typeof createLiveWorkspaceController>;
