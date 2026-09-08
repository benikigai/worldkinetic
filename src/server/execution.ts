import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { OperationSchema, ToolResultSchema, ToolExecutionError, type Artifact, type InputArtifact, type Operation, type Run, type ToolAdapter } from '../shared/contracts.js';
import type { RunStore } from './store.js';
import { ArtifactStore } from './artifacts.js';
import { ExecutionError } from './errors.js';

export interface Planner {
  identity: NonNullable<Run['provider']>;
  propose(run: Run, signal: AbortSignal): Promise<Operation>;
}
export interface SelectedOperation {
  name: string;
  parameters: z.ZodType<Record<string, number>>;
  planner: Planner;
  tool: ToolAdapter;
  baselineArtifacts?: InputArtifact[];
}

export class Executor {
  constructor(
    readonly store: RunStore, readonly artifacts: ArtifactStore, readonly runtimeDir: string,
    readonly selected: SelectedOperation | null, readonly timeoutMs = 120_000,
  ) {}

  async execute(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run || !this.selected) return;
    const abort = new AbortController();
    let imported: Artifact[] = [];
    const timer = setTimeout(() => abort.abort(new Error('Run timed out')), this.timeoutMs);
    let removeAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      const listener = () => reject(new Error('Run timed out'));
      abort.signal.addEventListener('abort', listener, { once: true });
      removeAbort = () => abort.signal.removeEventListener('abort', listener);
    });
    try {
      this.store.planning(runId, this.selected.planner.identity);
      const operation = OperationSchema.parse(await Promise.race([this.selected.planner.propose(run, abort.signal), timeout]));
      if (operation.name !== this.selected.name) throw new ExecutionError('UNSUPPORTED_OPERATION', 'Astra requested an operation outside the selected scope.');
      this.selected.parameters.parse(operation.parameters);
      this.store.running(runId, operation);
      const outputDir = path.join(this.runtimeDir, 'runs', runId, 'tool-output');
      await mkdir(outputDir, { recursive: true, mode: 0o700 });
      const priorRun = this.store.listRuns().find(item => item.designId === run.designId && item.outputRevisionId === run.inputRevisionId && item.status === 'succeeded' && item.executionMode === 'live');
      const inputArtifacts = priorRun ? priorRun.artifacts.map(artifact => ({
        artifactId: artifact.artifactId, revisionId: artifact.revisionId, kind: artifact.kind,
        path: path.resolve(this.artifacts.root, artifact.artifactId), sha256: artifact.sha256, units: artifact.units,
      })) : this.selected.baselineArtifacts ?? [];
      if (inputArtifacts.some(item => item.revisionId !== run.inputRevisionId || item.units !== run.units)) {
        throw new ExecutionError('INPUT_REVISION_MISMATCH', 'Input artifacts do not match the requested design revision.');
      }
      abort.signal.throwIfAborted();
      const result = ToolResultSchema.parse(await Promise.race([this.selected.tool({
        contractVersion: run.contractVersion, runId, designId: run.designId,
        inputRevisionId: run.inputRevisionId, outputRevisionId: run.outputRevisionId,
        units: run.units, operation: structuredClone(operation), outputDir, signal: abort.signal, inputArtifacts,
      }), timeout]));
      if (result.executionMode !== 'live') throw new ExecutionError('TOOL_NOT_LIVE', 'A fixture tool result cannot complete a live request.');
      for (const key of ['contractVersion', 'runId', 'designId', 'inputRevisionId', 'outputRevisionId', 'units'] as const) {
        if (result[key] !== run[key]) throw new Error(`Tool result identity mismatch: ${key}`);
      }
      if (result.operation.name !== operation.name || JSON.stringify(Object.entries(result.operation.parameters).sort()) !== JSON.stringify(Object.entries(operation.parameters).sort())) {
        throw new Error('Tool applied a different operation');
      }
      if (result.checks.some(check => check.revisionId !== run.outputRevisionId)) throw new Error('Check revision mismatch');
      if (new Set(result.checks.map(check => check.checkId)).size !== result.checks.length) throw new Error('Duplicate check identity');
      if (!result.artifacts.some(artifact => artifact.kind === 'editable')) throw new Error('Missing editable artifact');
      const refs = await Promise.race([this.artifacts.import(run, outputDir, result.artifacts, abort.signal), timeout]);
      imported = refs;
      this.store.complete(runId, result.checks, refs);
    } catch (error) {
      await this.artifacts.discard(imported);
      // Provider/tool errors may contain credentials or private subprocess output.
      const timedOut = abort.signal.aborted;
      const safeError = error instanceof ExecutionError || error instanceof ToolExecutionError ? error : null;
      this.store.fail(runId, {
        code: timedOut ? 'RUN_TIMEOUT' : safeError?.code ?? 'EXECUTION_FAILED',
        message: timedOut ? 'The run exceeded its execution deadline.' : safeError?.message ?? 'The provider or tool failed validation or execution. No revision was promoted.',
        retryable: timedOut || Boolean(safeError?.retryable),
      });
    } finally {
      clearTimeout(timer);
      removeAbort?.();
    }
  }
}
