import {
  AcceptanceRequestSchema, BootstrapSchema, CONTRACT_VERSION, ExportRequestSchema,
  LengthMmSchema, RequirementsUpdateRequestSchema, RunRequestSchema, canonicalize,
  parseStrictJson, sha256, verifyCandidateEvidence, verifyRequirements,
  type AcceptanceRequest, type Artifact, type Bootstrap, type Candidate, type Event,
  type ExportRequest, type RequirementsUpdateRequest, type RunRequest,
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

  async function artifactBytes(artifact: Artifact | ReferenceArtifact): Promise<ArrayBuffer> {
    const response = await request(artifact.href);
    if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== artifact.mediaType.toLowerCase()) {
      await response.body?.cancel();
      throw new LiveError(`Registered artifact unavailable or wrong media type (HTTP ${response.status}). Refresh and retry the download.`);
    }
    const bytes = await readBytes(response, artifact.bytes);
    if (bytes.byteLength !== artifact.bytes || await sha256(new Uint8Array(bytes)) !== artifact.sha256) {
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
  function gates() {
    const ready = trusted && !loading && !busy && !pending && !!bootstrap?.design && !!bootstrap.requirements;
    const numeric = bootstrap?.requirements?.setupId === 'resize_centered_v1';
    const length = draft.lengthMm.trim() === '' ? NaN : Number(draft.lengthMm);
    const validLength = LengthMmSchema.safeParse(length).success;
    const canConfirm = Boolean(ready && numeric && validLength);
    const candidate = selectedCandidate();
    const canAccept = Boolean(ready && numeric && candidate && candidate.revisionId === viewedRevisionId
      && candidate.status === 'reviewable' && liveEvidence(candidate)
      && same(candidate.requirements, bootstrap!.requirements));
    return {
      canConfirm,
      canRun: Boolean(ready && numeric && validLength && length === bootstrap!.requirements!.setup.dimensions.lengthMm
        && draft.instruction.trim().length > 0 && draft.instruction.trim().length <= 2000
        && bootstrap!.executionMode === 'live' && !bootstrap!.design!.acceptedRevisionId && !bootstrap!.design!.activeRunId),
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
        nextBytes = await artifactBytes(nextReference.artifacts.find(item => item.mediaType === 'model/stl')!);
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
      if (!draftEdited && !draft.lengthMm && requirements) draft = { ...draft, lengthMm: String(requirements.setup.dimensions.lengthMm) };
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
        || action.body.setupId !== 'resize_centered_v1'
        || requirements.setup.dimensions.lengthMm !== action.body.confirmedIntent.lengthMm
        || response.design.stateVersion !== action.body.expectedStateVersion + 1
        || response.design.activeRequirementsVersion !== requirements.requirementsVersion
        || response.design.designId !== requirements.designId || response.design.setupHash !== requirements.setupHash
        || response.design.setupId !== requirements.setupId || response.design.referenceId !== requirements.referenceId
        || response.design.referenceHash !== requirements.referenceHash || response.design.units !== requirements.units) {
        throw new LiveError('Requirements confirmation response does not match the original action. Reconcile before retrying.', 0, true);
      }
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
      const bytes = await artifactBytes(artifact);
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
    async confirmRequirements() {
      if (!gates().canConfirm) return;
      const body = RequirementsUpdateRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(), userActionId: newId(),
        expectedStateVersion: bootstrap!.design!.stateVersion, expectedRequirementsVersion: bootstrap!.requirements!.requirementsVersion,
        setupId: 'resize_centered_v1', confirmedIntent: { lengthMm: Number(draft.lengthMm) } });
      await mutate({ kind: 'requirements', path: `/api/designs/${bootstrap!.design!.designId}/requirements`, body });
    },
    async requestRun() {
      if (!gates().canRun) return;
      const body = RunRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: newId(), designId: bootstrap!.design!.designId,
        inputRevisionId: bootstrap!.design!.baselineRevisionId, requirementsVersion: bootstrap!.requirements!.requirementsVersion,
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
        const candidate = bootstrap?.candidates.find(item => item.revisionId === revisionId);
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
