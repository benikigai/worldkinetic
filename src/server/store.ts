import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  AcceptanceRequestSchema, AcceptanceSchema, BootstrapSchema, CandidateSchema, CONTRACT_VERSION,
  DesignSchema, EventSchema, ExportRequestSchema, ManifestSchema, RequirementsSchema,
  RequirementsUpdateRequestSchema, RunRequestSchema, RunSchema, canonicalize, checkBundleHashPayload,
  createRequirements, parseStrictJson, safeError, verifyCandidateEvidence,
  type AcceptanceRequest, type ApiError, type Candidate, type Design, type ExportRequest, type Manifest,
  type Requirements, type RequirementsUpdateRequest, type Run, type RunEvent, type RunRequest,
} from '../shared/contracts.js';
import { ArtifactStore } from './artifacts.js';

const requestRecord = z.object({
  requestId: z.string(), operation: z.enum(['run', 'accept', 'requirements', 'export']),
  payload: z.string(), identity: z.string(),
}).strict();
const SnapshotSchema = z.object({
  storageVersion: z.literal(2), design: DesignSchema.nullable(), requirements: z.array(RequirementsSchema),
  runs: z.array(RunSchema), candidates: z.array(CandidateSchema), events: z.array(EventSchema),
  requests: z.array(requestRecord), acceptances: z.array(AcceptanceSchema), manifests: z.array(ManifestSchema),
}).strict();
type Snapshot = z.infer<typeof SnapshotSchema>;
type Operation = z.infer<typeof requestRecord>['operation'];
const pending = (run: Run) => ['queued', 'planning', 'running'].includes(run.status);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export class StoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function conflict(code: 'STATE_CONFLICT' | 'EVIDENCE_CONFLICT' | 'IDENTITY_CONFLICT' = 'STATE_CONFLICT'): never {
  throw new StoreError(409, code, safeError(code).message);
}
export function requirementIdentity(r: Requirements) {
  return { requirementsVersion: r.requirementsVersion, requirementsId: r.requirementsId,
    registryId: r.registryId, registryHash: r.registryHash, setupId: r.setupId, setupHash: r.setupHash,
    referenceHash: r.referenceHash, validatorVersion: r.validatorVersion };
}
function requireRun(s: Snapshot, runId: string): Run {
  const run = s.runs.find(r => r.runId === runId);
  if (!run) throw new StoreError(404, 'INVALID_REQUEST', safeError('INVALID_REQUEST').message);
  return run;
}
function currentRequirements(s: Snapshot): Requirements {
  const r = s.requirements.find(r => r.requirementsVersion === s.design?.activeRequirementsVersion);
  if (!r) throw new StoreError(503, 'TOOL_UNAVAILABLE', safeError('TOOL_UNAVAILABLE').message);
  return r;
}
function checkRequirements(r: Requirements) {
  RequirementsSchema.parse(r);
  if (sha(r.setupCanonicalJson) !== r.setupHash || sha(r.registryCanonicalJson) !== r.registryHash
    || r.requirementsId !== `req_${sha(canonicalize({ designId: r.designId, requirementsVersion: r.requirementsVersion, setupHash: r.setupHash, validatorVersion: r.validatorVersion })).slice(0, 32)}`) conflict('EVIDENCE_CONFLICT');
}
function manifestPayload(m: Manifest) { const { manifestHash: _, ...payload } = m; return payload; }

/** One owner per runtime. Every mutation reserves its queue position before any await. */
export class RunStore {
  private snapshot: Snapshot;
  private boundary: Promise<unknown> = Promise.resolve();
  private readonly snapshotPath: string;
  private readonly artifacts: ArtifactStore;
  constructor(runtimeDir: string, initialDesign: Design | null, initialRequirements?: Requirements) {
    const directory = resolve(runtimeDir);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.snapshotPath = join(directory, 'state.json');
    this.artifacts = new ArtifactStore(join(directory, 'artifacts'));
    if (existsSync(this.snapshotPath)) {
      const raw = readFileSync(this.snapshotPath, 'utf8');
      let data: unknown;
      try { data = parseStrictJson(raw); } catch { throw this.corrupt(); }
      if ((data as { storageVersion?: number })?.storageVersion === 1) {
        throw new StoreError(500, 'LEGACY_SESSION', 'Storage version 1 is preserved. Start a new session in a fresh v2 runtime directory; automatic revisions cannot establish human acceptance.');
      }
      try { this.snapshot = SnapshotSchema.parse(data); this.validateSnapshot(this.snapshot); }
      catch { throw this.corrupt(); }
    } else {
      this.snapshot = { storageVersion: 2, design: initialDesign === null ? null : DesignSchema.parse(initialDesign),
        requirements: initialRequirements ? [structuredClone(initialRequirements)] : [], runs: [], candidates: [], events: [], requests: [], acceptances: [], manifests: [] };
      this.commit(this.snapshot);
    }
    const next = structuredClone(this.snapshot);
    let changed = false;
    if (!next.design && initialDesign && initialRequirements) {
      next.design = DesignSchema.parse(initialDesign); next.requirements = [structuredClone(initialRequirements)]; changed = true;
    }
    for (const run of next.runs.filter(pending)) {
      this.failIn(next, run, safeError('EXECUTION_FAILED')); changed = true;
    }
    if (changed) this.commit(next);
  }
  private corrupt() { return new StoreError(500, 'STORE_CORRUPT', 'Saved state is invalid. Preserve this runtime and start a new session.'); }
  private serialize<T>(fn: (next: Snapshot) => Promise<T> | T): Promise<T> {
    const result = this.boundary.then(async () => {
      const next = structuredClone(this.snapshot);
      const value = await fn(next);
      this.commit(next);
      return structuredClone(value);
    });
    this.boundary = result.catch(() => undefined);
    return result;
  }
  getDesign() { return structuredClone(this.snapshot.design); }
  getRequirements() { return this.snapshot.design ? structuredClone(currentRequirements(this.snapshot)) : null; }
  getRun(runId: string) { return structuredClone(requireRun(this.snapshot, runId)); }
  listRuns() { return structuredClone([...this.snapshot.runs].reverse()); }
  getCandidate(revisionId: string) {
    const c = this.snapshot.candidates.find(c => c.revisionId === revisionId);
    if (!c) throw new StoreError(404, 'INVALID_REQUEST', safeError('INVALID_REQUEST').message);
    return structuredClone(c);
  }
  listCandidates() { return structuredClone([...this.snapshot.candidates].reverse()); }
  getAcceptance(acceptanceId: string) { return structuredClone(this.snapshot.acceptances.find(a => a.acceptanceId === acceptanceId) ?? null); }
  listAcceptances() { return structuredClone([...this.snapshot.acceptances].reverse()); }
  getManifest(manifestId: string) { return structuredClone(this.snapshot.manifests.find(m => m.manifestId === manifestId) ?? null); }
  listManifests() { return structuredClone([...this.snapshot.manifests].reverse()); }
  getEvents(runId?: string, afterEventId = 0) {
    if (runId) requireRun(this.snapshot, runId);
    if (!Number.isSafeInteger(afterEventId) || afterEventId < 0) throw new StoreError(400, 'INVALID_REQUEST', safeError('INVALID_REQUEST').message);
    return structuredClone(this.snapshot.events.filter(e => (!runId || e.runId === runId) && e.eventId > afterEventId));
  }
  private retry(s: Snapshot, operation: Operation, request: { requestId: string }, payload: unknown = request) {
    const entry = s.requests.find(e => e.requestId === request.requestId);
    if (entry && (entry.operation !== operation || entry.payload !== canonicalize(payload))) conflict('IDENTITY_CONFLICT');
    return entry;
  }
  private remember(s: Snapshot, operation: Operation, request: { requestId: string }, identity: string, payload: unknown = request) {
    s.requests.push({ operation, requestId: request.requestId, payload: canonicalize(payload), identity });
  }
  getRunRetry(input: RunRequest) {
    const request = RunRequestSchema.parse(structuredClone(input));
    const retry = this.retry(this.snapshot, 'run', request);
    return retry ? { run: this.getRun(retry.identity), reused: true } : null;
  }
  enqueueRun(input: RunRequest) {
    const request = RunRequestSchema.parse(structuredClone(input));
    return this.serialize(s => {
      const retry = this.retry(s, 'run', request);
      if (retry) return { run: requireRun(s, retry.identity), reused: true };
      const d = s.design; const r = currentRequirements(s);
      if (!d || request.designId !== d.designId || request.inputRevisionId !== (d.acceptedRevisionId ?? d.baselineRevisionId)
        || request.requirementsVersion !== r.requirementsVersion || request.setupId !== r.setupId) conflict();
      d.stateVersion++;
      this.supersede(s, false);
      const now = new Date().toISOString(); const attemptId = id('attempt'); const revisionId = id('revision');
      const run: Run = { ...request, ...requirementIdentity(r), runId: id('run'), status: 'queued', executionMode: 'live',
        attemptIds: [attemptId], candidateRevisionIds: [revisionId], activeAttemptId: attemptId, createdAt: now, updatedAt: now, error: null };
      const candidate: Candidate = { contractVersion: CONTRACT_VERSION, ...requirementIdentity(r), runId: run.runId,
        requestId: request.requestId, designId: d.designId, attemptId, revisionId, inputRevisionId: run.inputRevisionId,
        requirements: r, units: 'mm', executionMode: 'live', status: 'building', createdAt: now, updatedAt: now,
        changeSummary: 'Candidate generation is pending.', engine: null, sourceSha256: null, proposalHash: null,
        geometryHash: null, checkBundleHash: null, checks: [], artifacts: [], error: null };
      s.runs.push(run); s.candidates.push(candidate); d.activeRunId = run.runId; d.selectedCandidateRevisionId = null;
      this.remember(s, 'run', request, run.runId);
      this.event(s, 'run.queued', run, candidate); this.event(s, 'candidate.building', run, candidate);
      return { run, reused: false };
    });
  }
  planning(runId: string) { return this.transition(runId, 'planning'); }
  running(runId: string) { return this.transition(runId, 'running'); }
  private transition(runId: string, status: 'planning' | 'running') {
    return this.serialize(s => {
      const run = requireRun(s, runId);
      if (!pending(run) || (status === 'planning' && run.status !== 'queued') || (status === 'running' && run.status === 'running')) conflict();
      run.status = status; run.updatedAt = new Date().toISOString(); s.design!.stateVersion++;
      this.event(s, `run.${status}`, run, s.candidates.find(c => c.runId === runId)!); return run;
    });
  }
  checking(runId: string) {
    return this.serialize(s => {
      const run = requireRun(s, runId); const c = s.candidates.find(c => c.runId === runId)!;
      if (run.status !== 'running' || c.status !== 'building') conflict();
      c.status = 'checking'; c.updatedAt = new Date().toISOString(); s.design!.stateVersion++;
      this.event(s, 'candidate.checking', run, c); return c;
    });
  }
  completeCandidate(input: Candidate, signal?: AbortSignal) {
    const isolated = structuredClone(input);
    return this.serialize(async s => {
      let candidate: Candidate;
      try { signal?.throwIfAborted(); candidate = await verifyCandidateEvidence(isolated); signal?.throwIfAborted(); } catch { conflict('EVIDENCE_CONFLICT'); }
      const run = requireRun(s, candidate.runId);
      const draft = s.candidates.find(c => c.revisionId === candidate.revisionId);
      if (!draft || !['building', 'checking', 'superseded'].includes(draft.status)
        || !['reviewable', 'rejected'].includes(candidate.status)
        || ['failed', 'cancelled', 'completed'].includes(run.status)) conflict();
      for (const key of ['runId', 'requestId', 'designId', 'revisionId', 'attemptId', 'inputRevisionId', 'createdAt'] as const) {
        if (candidate[key] !== draft[key]) conflict('EVIDENCE_CONFLICT');
      }
      if (canonicalize(candidate.requirements) !== canonicalize(draft.requirements)) conflict('EVIDENCE_CONFLICT');
      if (candidate.artifacts.some(a => s.candidates.some(c => c.revisionId !== candidate.revisionId && c.artifacts.some(b => b.artifactId === a.artifactId)))) conflict('IDENTITY_CONFLICT');
      const d = s.design!;
      const compatible = pending(run) && d.activeRunId === run.runId && d.activeRequirementsVersion === run.requirementsVersion
        && run.inputRevisionId === (d.acceptedRevisionId ?? d.baselineRevisionId) && candidate.setupHash === d.setupHash;
      if (!compatible) candidate.status = 'superseded';
      candidate.updatedAt = new Date().toISOString();
      s.candidates[s.candidates.indexOf(draft)] = candidate;
      run.status = compatible ? 'completed' : 'superseded'; run.activeAttemptId = null; run.updatedAt = candidate.updatedAt;
      if (compatible) { d.selectedCandidateRevisionId = candidate.revisionId; d.activeRunId = null; }
      d.stateVersion++;
      this.event(s, `candidate.${candidate.status}`, run, candidate);
      this.event(s, compatible ? 'run.completed' : 'run.superseded', run, candidate);
      return candidate;
    });
  }
  fail(runId: string, error: ApiError) {
    const isolated = safeError(error.code);
    return this.serialize(s => { const run = requireRun(s, runId); if (pending(run)) this.failIn(s, run, isolated); return run; });
  }
  private failIn(s: Snapshot, run: Run, error: ApiError) {
    run.status = 'failed'; run.activeAttemptId = null; run.error = error; run.updatedAt = new Date().toISOString();
    const c = s.candidates.find(c => c.runId === run.runId)!; c.status = 'failed'; c.error = error; c.updatedAt = run.updatedAt;
    if (s.design!.activeRunId === run.runId) s.design!.activeRunId = null;
    s.design!.stateVersion++; this.event(s, 'candidate.failed', run, c); this.event(s, 'run.failed', run, c);
  }
  private supersede(s: Snapshot, requirementsChanged: boolean) {
    for (const c of s.candidates) {
      const run = requireRun(s, c.runId);
      if ((requirementsChanged && c.requirementsVersion !== s.design!.activeRequirementsVersion) || pending(run)) {
        c.status = 'superseded'; c.updatedAt = new Date().toISOString();
        if (pending(run)) { run.status = 'superseded'; run.activeAttemptId = null; run.updatedAt = c.updatedAt; this.event(s, 'run.superseded', run, c); }
        this.event(s, 'candidate.superseded', run, c);
      }
    }
  }
  updateRequirements(input: RequirementsUpdateRequest) {
    const request = RequirementsUpdateRequestSchema.parse(structuredClone(input));
    return this.serialize(async s => {
      const retry = this.retry(s, 'requirements', request);
      if (retry) {
        const event = s.events.find(e => e.type === 'requirements.updated' && String(e.eventId) === retry.identity)!;
        const requirements = s.requirements.find(r => r.requirementsVersion === event.requirementsVersion)!;
        return { design: this.designAtUpdate(s, event), requirements, reused: true };
      }
      const d = s.design; const old = currentRequirements(s);
      if (!d || request.expectedStateVersion !== d.stateVersion || request.expectedRequirementsVersion !== old.requirementsVersion) conflict();
      const requirements = await createRequirements({ designId: d.designId, requirementsVersion: old.requirementsVersion + 1,
        setupId: request.setupId, ...(request.setupId === 'resize_centered_v1' ? { lengthMm: request.confirmedIntent.lengthMm } : {}), validatorVersion: old.validatorVersion });
      s.requirements.push(requirements); d.activeRequirementsVersion = requirements.requirementsVersion;
      d.setupId = requirements.setupId; d.setupHash = requirements.setupHash; d.stateVersion++;
      d.activeRunId = null; d.selectedCandidateRevisionId = null; d.acceptedRequirementsMatch = false;
      this.supersede(s, true);
      const event = this.event(s, 'requirements.updated');
      this.remember(s, 'requirements', request, String(event.eventId));
      return { design: d, requirements, reused: false };
    });
  }
  private designAtUpdate(s: Snapshot, event: RunEvent): Design {
    const r = s.requirements.find(r => r.requirementsVersion === event.requirementsVersion)!;
    const a = [...s.acceptances].reverse().find(a => a.stateVersion < event.stateVersion);
    return { ...s.design!, stateVersion: event.stateVersion, activeRequirementsVersion: r.requirementsVersion,
      setupId: r.setupId, setupHash: r.setupHash, activeRunId: null, selectedCandidateRevisionId: null,
      acceptedRevisionId: a?.candidate.revisionId ?? null, acceptedRequirementsMatch: false };
  }
  private async eligible(s: Snapshot, candidate: Candidate) {
    try {
      const c = await verifyCandidateEvidence(candidate); const r = currentRequirements(s);
      if (c.executionMode !== 'live' || c.engine?.name === 'fixture' || c.status !== 'reviewable'
        || canonicalize(c.requirements) !== canonicalize(r) || c.artifacts.some(a => a.executionMode !== 'live')) conflict('EVIDENCE_CONFLICT');
      for (const artifact of c.artifacts) await this.artifacts.read(artifact);
    } catch { conflict('EVIDENCE_CONFLICT'); }
  }
  acceptRevision(input: AcceptanceRequest) {
    const request = AcceptanceRequestSchema.parse(structuredClone(input));
    return this.serialize(async s => {
      const retry = this.retry(s, 'accept', request);
      if (retry) return { acceptance: s.acceptances.find(a => a.acceptanceId === retry.identity)!, manifest: s.manifests.find(m => m.acceptanceId === retry.identity)!, reused: true };
      const d = s.design; const c = s.candidates.find(c => c.revisionId === request.candidateRevisionId);
      if (!d || !c || request.designId !== d.designId || request.expectedStateVersion !== d.stateVersion
        || request.expectedAcceptedRevisionId !== d.acceptedRevisionId || request.candidateRevisionId !== d.selectedCandidateRevisionId
        || request.requirementsVersion !== d.activeRequirementsVersion) conflict();
      if (['registryHash', 'setupHash', 'geometryHash', 'checkBundleHash'].some(key => request[key as 'registryHash'] !== c[key as 'registryHash'])) conflict('EVIDENCE_CONFLICT');
      await this.eligible(s, c);
      d.stateVersion++; d.acceptedRevisionId = c.revisionId; d.acceptedRequirementsMatch = true;
      const acceptance = AcceptanceSchema.parse({ contractVersion: CONTRACT_VERSION, acceptanceId: id('acceptance'), request,
        acceptedAt: new Date().toISOString(), stateVersion: d.stateVersion, candidate: c, requirements: c.requirements });
      const payload = { contractVersion: CONTRACT_VERSION, manifestId: id('manifest'), acceptanceId: acceptance.acceptanceId,
        designId: d.designId, runId: c.runId, revisionId: c.revisionId, requirements: c.requirements,
        checkBundleHash: c.checkBundleHash!, geometryHash: c.geometryHash!, sourceSha256: c.sourceSha256!, proposalHash: c.proposalHash!,
        engine: c.engine, checks: c.checks, changeSummary: c.changeSummary, units: c.units, artifacts: c.artifacts };
      const manifest = ManifestSchema.parse({ ...payload, manifestHash: sha(canonicalize(payload)) });
      s.acceptances.push(acceptance); s.manifests.push(manifest); this.remember(s, 'accept', request, acceptance.acceptanceId);
      this.event(s, 'revision.accepted', requireRun(s, c.runId), c, acceptance.acceptanceId);
      return { acceptance, manifest, reused: false };
    });
  }
  exportRevision(revisionId: string, input: ExportRequest) {
    const request = ExportRequestSchema.parse(structuredClone(input)); const payload = { revisionId, request };
    return this.serialize(async s => {
      const retry = this.retry(s, 'export', request, payload);
      const manifest = s.manifests.find(m => m.manifestId === request.manifestId);
      const acceptance = s.acceptances.find(a => a.acceptanceId === request.acceptanceId);
      if (!manifest || !acceptance || s.acceptances.at(-1)?.acceptanceId !== acceptance.acceptanceId || manifest.acceptanceId !== acceptance.acceptanceId || manifest.revisionId !== revisionId
        || manifest.manifestHash !== request.manifestHash || s.design?.acceptedRevisionId !== revisionId || !s.design.acceptedRequirementsMatch) conflict();
      await this.eligible(s, acceptance.candidate);
      if (!retry) this.remember(s, 'export', request, manifest.manifestId, payload);
      return { acceptance, manifest, reused: Boolean(retry) };
    });
  }
  private event(s: Snapshot, type: RunEvent['type'], run: Run | null = null, candidate: Candidate | null = null, acceptanceId: string | null = null) {
    const d = s.design!;
    const event = EventSchema.parse({ contractVersion: CONTRACT_VERSION, eventId: (s.events.at(-1)?.eventId ?? 0) + 1,
      designId: d.designId, stateVersion: d.stateVersion, runId: run?.runId ?? null, revisionId: candidate?.revisionId ?? null,
      requirementsVersion: run?.requirementsVersion ?? d.activeRequirementsVersion, units: 'mm', executionMode: run?.executionMode ?? 'live',
      createdAt: new Date().toISOString(), type, run, candidate, acceptanceId });
    s.events.push(event); return event;
  }
  private validateSnapshot(s: Snapshot) {
    for (const values of [s.runs.map(r => r.runId), s.candidates.map(c => c.revisionId), s.requests.map(r => r.requestId), s.requirements.map(r => r.requirementsVersion), s.acceptances.map(a => a.acceptanceId), s.manifests.map(m => m.manifestId)]) {
      if (new Set<string | number>(values).size !== values.length) throw this.corrupt();
    }
    for (const r of s.requirements) { checkRequirements(r); if (r.designId !== s.design?.designId) throw this.corrupt(); }
    BootstrapSchema.parse({ contractVersion: CONTRACT_VERSION, design: s.design, requirements: s.design ? currentRequirements(s) : null,
      scopeStatus: s.design ? 'selected' : 'not_selected', executionMode: 'unavailable', runs: s.runs, candidates: s.candidates, unavailableReason: 'Runtime validation.' });
    for (const c of [...s.candidates, ...s.events.flatMap(e => e.candidate ? [e.candidate] : []), ...s.acceptances.map(a => a.candidate)]) {
      checkRequirements(c.requirements);
      if (!s.requirements.some(r => canonicalize(r) === canonicalize(c.requirements))) throw this.corrupt();
      if (c.checkBundleHash !== null) {
        CandidateSchema.parse({ ...c, status: c.checks.every(check => check.state === 'passed') ? 'reviewable' : 'rejected' });
        if (sha(canonicalize(checkBundleHashPayload(c))) !== c.checkBundleHash) throw this.corrupt();
      }
    }
    for (const run of s.runs) {
      if (run.attemptIds.length !== 1 || run.candidateRevisionIds.length !== 1) throw this.corrupt();
      const c = s.candidates.find(c => c.revisionId === run.candidateRevisionIds[0]);
      if (!c || c.runId !== run.runId || c.attemptId !== run.attemptIds[0] || c.executionMode !== run.executionMode
        || (pending(run) && !['building', 'checking'].includes(c.status))
        || (run.status === 'completed' && !['reviewable', 'rejected', 'superseded'].includes(c.status))) throw this.corrupt();
    }
    for (const [i, e] of s.events.entries()) {
      if (e.eventId !== i + 1 || e.stateVersion > s.design!.stateVersion || (i && e.stateVersion < s.events[i - 1]!.stateVersion)
        || e.designId !== s.design?.designId || (e.runId && !s.runs.some(r => r.runId === e.runId))) throw this.corrupt();
    }
    for (const [index, a] of s.acceptances.entries()) {
      const c = a.candidate;
      const registered = s.candidates.find(value => value.revisionId === c.revisionId);
      if (!registered || canonicalize(checkBundleHashPayload(registered)) !== canonicalize(checkBundleHashPayload(c))
        || canonicalize(registered.artifacts) !== canonicalize(c.artifacts)
        || a.request.expectedAcceptedRevisionId !== (s.acceptances[index - 1]?.candidate.revisionId ?? null)) throw this.corrupt();
      if (c.status !== 'reviewable' || c.executionMode !== 'live' || a.stateVersion !== a.request.expectedStateVersion + 1
        || a.request.candidateRevisionId !== c.revisionId || a.request.designId !== c.designId
        || a.request.requirementsVersion !== c.requirementsVersion || canonicalize(a.requirements) !== canonicalize(c.requirements)
        || ['registryHash', 'setupHash', 'geometryHash', 'checkBundleHash'].some(k => a.request[k as 'registryHash'] !== c[k as 'registryHash'])
        || sha(canonicalize(checkBundleHashPayload(c))) !== c.checkBundleHash
        || !s.events.some(e => e.acceptanceId === a.acceptanceId && e.stateVersion === a.stateVersion)) throw this.corrupt();
    }
    for (const m of s.manifests) {
      const a = s.acceptances.find(a => a.acceptanceId === m.acceptanceId);
      if (!a || m.manifestHash !== sha(canonicalize(manifestPayload(m))) || m.revisionId !== a.candidate.revisionId
        || canonicalize(m.artifacts) !== canonicalize(a.candidate.artifacts) || m.checkBundleHash !== a.candidate.checkBundleHash
        || m.designId !== a.candidate.designId || m.runId !== a.candidate.runId || m.geometryHash !== a.candidate.geometryHash
        || m.sourceSha256 !== a.candidate.sourceSha256 || m.proposalHash !== a.candidate.proposalHash
        || m.changeSummary !== a.candidate.changeSummary || canonicalize(m.engine) !== canonicalize(a.candidate.engine)
        || canonicalize(m.checks) !== canonicalize(a.candidate.checks) || canonicalize(m.requirements) !== canonicalize(a.requirements)) throw this.corrupt();
    }
    const d = s.design;
    if (d?.selectedCandidateRevisionId) {
      const selected = s.candidates.find(c => c.revisionId === d.selectedCandidateRevisionId);
      if (!selected || !['reviewable', 'rejected'].includes(selected.status) || selected.requirementsVersion !== d.activeRequirementsVersion) throw this.corrupt();
    }
    if (d?.acceptedRevisionId) {
      const a = [...s.acceptances].reverse().find(a => a.candidate.revisionId === d.acceptedRevisionId);
      if (!a || s.acceptances.at(-1)?.acceptanceId !== a.acceptanceId || d.acceptedRequirementsMatch !== (a.candidate.requirementsVersion === d.activeRequirementsVersion)) throw this.corrupt();
    }
    if (s.events.some(e => e.type === 'revision.accepted' && !s.acceptances.some(a => a.acceptanceId === e.acceptanceId))) throw this.corrupt();
    if (!d?.acceptedRevisionId && s.acceptances.length) throw this.corrupt();
    if (s.acceptances.length !== s.manifests.length) throw this.corrupt();
    for (const entry of s.requests) {
      const payload = parseStrictJson(entry.payload);
      if (canonicalize(payload) !== entry.payload) throw this.corrupt();
      if (entry.operation === 'run') {
        const request = RunRequestSchema.parse(payload); const run = requireRun(s, entry.identity);
        if (request.requestId !== entry.requestId || Object.entries(request).some(([k, v]) => run[k as keyof Run] !== v)) throw this.corrupt();
      } else if (entry.operation === 'accept') {
        const request = AcceptanceRequestSchema.parse(payload); const a = s.acceptances.find(a => a.acceptanceId === entry.identity);
        if (!a || request.requestId !== entry.requestId || canonicalize(a.request) !== entry.payload) throw this.corrupt();
      } else if (entry.operation === 'requirements') {
        const request = RequirementsUpdateRequestSchema.parse(payload); const e = s.events.find(e => String(e.eventId) === entry.identity && e.type === 'requirements.updated');
        const r = s.requirements.find(r => r.requirementsVersion === e?.requirementsVersion);
        if (!e || !r || request.requestId !== entry.requestId || request.expectedStateVersion + 1 !== e.stateVersion
          || request.expectedRequirementsVersion + 1 !== r.requirementsVersion || request.setupId !== r.setupId
          || (request.setupId === 'resize_centered_v1' && request.confirmedIntent.lengthMm !== r.setup.dimensions.lengthMm)) throw this.corrupt();
      } else {
        const p = z.object({ revisionId: z.string(), request: ExportRequestSchema }).strict().parse(payload);
        const m = s.manifests.find(m => m.manifestId === entry.identity);
        if (!m || p.request.requestId !== entry.requestId || p.request.manifestId !== m.manifestId || p.request.manifestHash !== m.manifestHash
          || p.request.acceptanceId !== m.acceptanceId || p.revisionId !== m.revisionId) throw this.corrupt();
      }
    }
    if (s.runs.some(r => !s.requests.some(e => e.operation === 'run' && e.identity === r.runId))
      || s.acceptances.some(a => !s.requests.some(e => e.operation === 'accept' && e.identity === a.acceptanceId))) throw this.corrupt();
  }
  private commit(next: Snapshot) {
    const parsed = SnapshotSchema.parse(next); this.validateSnapshot(parsed);
    const temporary = `${this.snapshotPath}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, JSON.stringify(parsed)); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, this.snapshotPath); this.snapshot = parsed;
    } finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary); }
  }
}
