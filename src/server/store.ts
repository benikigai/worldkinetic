import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ArtifactSchema, CheckSchema, CONTRACT_VERSION, DesignSchema, ErrorSchema, EventSchema,
  OperationSchema, RunRequestSchema, RunSchema,
  type ApiError, type Artifact, type Check, type Design, type Operation,
  type Run, type RunEvent, type RunRequest,
} from '../shared/contracts.js';

const SnapshotSchema = z.object({
  storageVersion: z.literal(1),
  design: DesignSchema.nullable(),
  runs: z.array(RunSchema),
  requests: z.array(z.object({ request: RunRequestSchema, runId: z.string() }).strict()),
  events: z.array(EventSchema),
}).strict();
type Snapshot = z.infer<typeof SnapshotSchema>;
const pendingStatuses = new Set<Run['status']>(['queued', 'planning', 'running']);

export class StoreError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

function requestKey(request: RunRequest): string {
  return JSON.stringify([
    request.contractVersion, request.requestId, request.designId, request.inputRevisionId,
    request.units, request.instruction,
  ]);
}

function requireRun(snapshot: Snapshot, runId: string): Run {
  const run = snapshot.runs.find((candidate) => candidate.runId === runId);
  if (!run) throw new StoreError(404, 'RUN_NOT_FOUND', 'The requested run does not exist.');
  return run;
}

function applicability(run: Run, design: Design | null): Run['evidenceApplicability'] {
  if (run.executionMode === 'fixture') return 'fixture';
  if (run.status === 'failed' || run.executionMode === 'unavailable') return 'unavailable';
  if (run.status === 'succeeded') {
    return design?.designId === run.designId
      && design.currentRevisionId === run.outputRevisionId
      && design.latestRunId === run.runId ? 'current' : 'historical';
  }
  if (run.status === 'superseded' || design?.latestRunId !== run.runId) return 'historical';
  return 'pending';
}

/** One process owns a runtime directory. The server must hold its runtime lock. */
export class RunStore {
  private readonly snapshotPath: string;
  private snapshot: Snapshot;

  constructor(runtimeDir: string, initialDesign: Design | null) {
    const directory = resolve(runtimeDir);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.snapshotPath = join(directory, 'state.json');
    const design = initialDesign === null ? null : DesignSchema.parse(initialDesign);

    if (existsSync(this.snapshotPath)) {
      try {
        this.snapshot = SnapshotSchema.parse(JSON.parse(readFileSync(this.snapshotPath, 'utf8')));
        this.validateSnapshot(this.snapshot);
      } catch {
        throw new StoreError(500, 'STORE_CORRUPT', 'Saved run state is invalid. Preserve it for inspection before resetting this runtime.');
      }
    } else {
      this.snapshot = { storageVersion: 1, design, runs: [], requests: [], events: [] };
      this.persist(this.snapshot);
    }

    const recovered = structuredClone(this.snapshot);
    let changed = false;
    // Selecting a design after an empty, unselected first boot is safe.
    if (!recovered.design && recovered.runs.length === 0 && design) {
      recovered.design = design;
      changed = true;
    }
    for (const run of recovered.runs) {
      if (!pendingStatuses.has(run.status)) continue;
      run.status = 'failed';
      run.updatedAt = new Date().toISOString();
      run.error = {
        code: 'RUN_INTERRUPTED',
        message: 'The server stopped before this run completed. Start a new request to retry.',
        retryable: true,
      };
      run.evidenceApplicability = 'unavailable';
      this.appendEvent(recovered, run, 'run.failed');
      changed = true;
    }
    if (changed) this.commit(recovered);
  }

  getDesign(): Design | null {
    return structuredClone(this.snapshot.design);
  }

  listRuns(): Run[] {
    return [...this.snapshot.runs].reverse().map((run) => this.present(run));
  }

  getRun(runId: string): Run {
    return this.present(requireRun(this.snapshot, runId));
  }

  getEvents(runId: string, afterEventId = 0): RunEvent[] {
    requireRun(this.snapshot, runId);
    if (!Number.isSafeInteger(afterEventId) || afterEventId < 0) {
      throw new StoreError(400, 'INVALID_EVENT_CURSOR', 'The event cursor must be a nonnegative integer.');
    }
    return this.snapshot.events
      .filter((event) => event.runId === runId && event.eventId > afterEventId)
      .map((event) => ({ ...structuredClone(event), run: this.present(event.run) }));
  }

  accept(input: RunRequest): { run: Run; reused: boolean } {
    const request = RunRequestSchema.parse(input);
    const previous = this.snapshot.requests.find((entry) => entry.request.requestId === request.requestId);
    // A retry is resolved before revision validation, including after restart.
    if (previous) {
      if (requestKey(previous.request) !== requestKey(request)) {
        throw new StoreError(409, 'REQUEST_ID_CONFLICT', 'This request ID was already used with different inputs.');
      }
      return { run: this.getRun(previous.runId), reused: true };
    }
    const design = this.snapshot.design;
    if (!design) throw new StoreError(503, 'DESIGN_NOT_SELECTED', 'A design must be selected before starting a run.');
    if (request.designId !== design.designId) {
      throw new StoreError(409, 'DESIGN_CONFLICT', 'This request does not target the selected design.');
    }
    if (request.inputRevisionId !== design.currentRevisionId) {
      throw new StoreError(409, 'REVISION_CONFLICT', 'The requested input revision is no longer current. Refresh the design before retrying.');
    }

    const next = structuredClone(this.snapshot);
    const now = new Date().toISOString();
    const run: Run = {
      contractVersion: CONTRACT_VERSION,
      runId: `run_${randomUUID()}`, requestId: request.requestId, designId: request.designId,
      inputRevisionId: request.inputRevisionId, outputRevisionId: `revision_${randomUUID()}`,
      units: 'mm', instruction: request.instruction, status: 'queued', executionMode: 'live',
      createdAt: now, updatedAt: now, operation: null, checks: [], artifacts: [],
      evidenceApplicability: 'pending', error: null, provider: null,
    };
    next.runs.push(run);
    next.requests.push({ request, runId: run.runId });
    next.design!.latestRunId = run.runId;
    this.appendEvent(next, run, 'run.accepted');
    this.commit(next);
    return { run: this.getRun(run.runId), reused: false };
  }

  planning(runId: string, provider: NonNullable<Run['provider']>): Run {
    const parsedProvider = RunSchema.shape.provider.unwrap().parse(provider);
    return this.update(runId, (run, next) => {
      this.requireStatus(run, ['queued']);
      run.status = 'planning';
      run.provider = parsedProvider;
      this.appendEvent(next, run, 'run.planning');
    });
  }

  running(runId: string, operation: Operation): Run {
    const parsedOperation = OperationSchema.parse(operation);
    return this.update(runId, (run, next) => {
      this.requireStatus(run, ['queued', 'planning']);
      run.status = 'running';
      run.operation = parsedOperation;
      this.appendEvent(next, run, 'run.running');
    });
  }

  complete(runId: string, checks: Check[], artifacts: Artifact[]): Run {
    const parsedChecks = z.array(CheckSchema).parse(checks);
    const parsedArtifacts = z.array(ArtifactSchema).parse(artifacts);
    return this.update(runId, (run, next) => {
      this.requireStatus(run, ['running']);
      if (parsedChecks.some((check) => check.revisionId !== run.outputRevisionId)
        || parsedArtifacts.some((artifact) => artifact.revisionId !== run.outputRevisionId
          || artifact.runId !== run.runId || artifact.designId !== run.designId || artifact.units !== run.units)) {
        throw new StoreError(409, 'EVIDENCE_REVISION_MISMATCH', 'Check and artifact evidence must belong to this run and its output revision.');
      }
      if (new Set(parsedChecks.map((check) => check.checkId)).size !== parsedChecks.length
        || new Set(parsedArtifacts.map((artifact) => artifact.artifactId)).size !== parsedArtifacts.length
        || parsedArtifacts.some((artifact) => next.runs.some((other) => other.runId !== run.runId
          && other.artifacts.some((existing) => existing.artifactId === artifact.artifactId)))) {
        throw new StoreError(409, 'DUPLICATE_EVIDENCE_ID', 'Check and artifact IDs must identify distinct evidence.');
      }
      if (parsedArtifacts.some((artifact) => artifact.executionMode === 'unavailable')) {
        throw new StoreError(409, 'EVIDENCE_UNAVAILABLE', 'Unavailable artifacts cannot complete a run.');
      }
      const isFixture = parsedArtifacts.some((artifact) => artifact.executionMode === 'fixture');
      if (isFixture && parsedArtifacts.some((artifact) => artifact.executionMode === 'live')) {
        throw new StoreError(409, 'EVIDENCE_MODE_MISMATCH', 'Fixture and live artifacts cannot be mixed in a run.');
      }
      run.executionMode = isFixture ? 'fixture' : 'live';
      run.checks = parsedChecks;
      run.artifacts = parsedArtifacts;
      const compatible = next.design?.designId === run.designId
        && next.design.currentRevisionId === run.inputRevisionId
        && next.design.latestRunId === run.runId;
      run.status = compatible ? 'succeeded' : 'superseded';
      if (compatible && !isFixture) next.design!.currentRevisionId = run.outputRevisionId;
      run.evidenceApplicability = applicability(run, next.design);
      this.appendEvent(next, run, compatible ? 'run.completed' : 'run.superseded');
    });
  }

  fail(runId: string, error: ApiError): Run {
    const parsedError = ErrorSchema.parse(error);
    return this.update(runId, (run, next) => {
      this.requireStatus(run, ['queued', 'planning', 'running']);
      run.status = 'failed';
      run.error = parsedError;
      run.evidenceApplicability = 'unavailable';
      this.appendEvent(next, run, 'run.failed');
    });
  }

  private present(run: Run): Run {
    return { ...structuredClone(run), evidenceApplicability: applicability(run, this.snapshot.design) };
  }

  private update(runId: string, mutate: (run: Run, next: Snapshot) => void): Run {
    const next = structuredClone(this.snapshot);
    const run = requireRun(next, runId);
    run.updatedAt = new Date().toISOString();
    mutate(run, next);
    this.commit(next);
    return this.getRun(runId);
  }

  private requireStatus(run: Run, statuses: Run['status'][]): void {
    if (!statuses.includes(run.status)) {
      throw new StoreError(409, 'RUN_STATE_CONFLICT', `A ${run.status} run cannot perform this transition.`);
    }
  }

  private appendEvent(snapshot: Snapshot, run: Run, type: RunEvent['type']): void {
    snapshot.events.push({
      contractVersion: CONTRACT_VERSION,
      eventId: (snapshot.events.at(-1)?.eventId ?? 0) + 1,
      runId: run.runId, designId: run.designId, revisionId: run.outputRevisionId, units: run.units,
      type, createdAt: run.updatedAt,
      run: { ...structuredClone(run), evidenceApplicability: applicability(run, snapshot.design) },
    });
  }

  private commit(snapshot: Snapshot): void {
    this.persist(snapshot);
    this.snapshot = snapshot;
  }

  private persist(snapshot: Snapshot): void {
    const temporaryPath = `${this.snapshotPath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(snapshot));
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.snapshotPath);
    } catch {
      throw new StoreError(500, 'STORE_WRITE_FAILED', 'Run state could not be saved. The operation was not accepted.');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }

  private validateSnapshot(snapshot: Snapshot): void {
    const runIds = new Set(snapshot.runs.map((run) => run.runId));
    const requestIds = new Set(snapshot.requests.map((entry) => entry.request.requestId));
    if (runIds.size !== snapshot.runs.length || requestIds.size !== snapshot.requests.length
      || snapshot.requests.length !== snapshot.runs.length) throw new Error('Duplicate or missing run identity.');
    for (const entry of snapshot.requests) {
      const run = requireRun(snapshot, entry.runId);
      if (requestKey(entry.request) !== requestKey({
        contractVersion: run.contractVersion, requestId: run.requestId, designId: run.designId,
        inputRevisionId: run.inputRevisionId, units: run.units, instruction: run.instruction,
      })) throw new Error('Run request identity mismatch.');
    }
    let previousEventId = 0;
    for (const event of snapshot.events) {
      const run = requireRun(snapshot, event.runId);
      if (event.eventId <= previousEventId || event.run.runId !== run.runId
        || event.designId !== run.designId || event.revisionId !== run.outputRevisionId) {
        throw new Error('Event identity mismatch.');
      }
      previousEventId = event.eventId;
    }
    if (snapshot.design?.latestRunId && !runIds.has(snapshot.design.latestRunId)) {
      throw new Error('Latest run identity missing.');
    }
  }
}
