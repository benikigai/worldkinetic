import { mkdir, lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { ErrorCodeSchema, ProviderProposalSchema, safeError, verifyToolInput, verifyToolResult, type Artifact, type InputArtifact, type ProviderProposal, type Requirements, type Run, type ToolAdapter } from '../shared/contracts.js';
import { ExecutionError } from './errors.js';
import type { RunStore } from './store.js';
import { ArtifactStore } from './artifacts.js';

export interface Planner {
  identity: { name: string; requestedModel: string; reportedModel: string | null };
  propose(run: Run, signal: AbortSignal, requirements: Requirements): Promise<ProviderProposal>;
}
export interface SelectedOperation {
  name: string;
  parameters: z.ZodType<Record<string, number>>;
  planner: Planner;
  tool: ToolAdapter;
  baselineArtifacts?: InputArtifact[];
  baselineOnly?: boolean;
}
export class Executor {
  constructor(readonly store: RunStore, readonly artifacts: ArtifactStore, readonly runtimeDir: string,
    readonly selected: SelectedOperation | null, readonly timeoutMs = 120_000) {}
  async execute(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!this.selected || run.status !== 'queued') return;
    const candidate = this.store.getCandidate(run.candidateRevisionIds[0]!);
    const abort = new AbortController();
    let imported: Artifact[] = [];
    const deadline = Date.now() + this.timeoutMs;
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let listener!: () => void;
    const timeout = new Promise<never>((_, reject) => {
      listener = () => reject(new Error('Deadline exceeded'));
      abort.signal.addEventListener('abort', listener, { once: true });
    });
    try {
      if (this.selected.baselineOnly && (run.inputRevisionId !== this.store.getDesign()?.baselineRevisionId
        || this.store.getDesign()?.acceptedRevisionId !== null)) throw new ExecutionError('TOOL_UNAVAILABLE', 'The engineering runtime is unavailable.');
      await this.store.planning(runId);
      const proposal = ProviderProposalSchema.parse(await Promise.race([
        this.selected.planner.propose(structuredClone(run), abort.signal, structuredClone(candidate.requirements)), timeout,
      ]));
      if (proposal.kind === 'numeric_operation') {
        if (proposal.operation.name !== this.selected.name) throw new Error('Unsupported operation');
        this.selected.parameters.parse(proposal.operation.parameters);
      }
      const prior = this.store.listCandidates().find(c => c.revisionId === run.inputRevisionId && c.executionMode === 'live');
      const inputArtifacts: InputArtifact[] = prior ? prior.artifacts.map(a => ({ artifactId: a.artifactId, revisionId: a.revisionId,
        kind: a.kind, units: a.units, path: path.resolve(this.artifacts.root, a.artifactId), sha256: a.sha256 })) : structuredClone(this.selected.baselineArtifacts ?? []);
      for (const a of inputArtifacts) {
        if ((await lstat(a.path)).isSymbolicLink() || !(await lstat(a.path)).isFile()
          || createHash('sha256').update(await readFile(a.path)).digest('hex') !== a.sha256) throw new Error('Input artifact integrity mismatch');
      }
      const outputDir = path.join(this.runtimeDir, 'runs', runId, 'tool-output');
      const data = await verifyToolInput({ contractVersion: run.contractVersion, runId, requestId: run.requestId, designId: run.designId,
        inputRevisionId: run.inputRevisionId, outputRevisionId: candidate.revisionId, attemptId: candidate.attemptId,
        units: run.units, requirements: candidate.requirements, registryCanonicalJson: candidate.requirements.registryCanonicalJson,
        setupCanonicalJson: candidate.requirements.setupCanonicalJson, proposal, outputDir, deadline: new Date(deadline).toISOString(), inputArtifacts });
      await this.store.running(runId);
      await mkdir(path.dirname(outputDir), { recursive: true, mode: 0o700 });
      abort.signal.throwIfAborted();
      const raw = await Promise.race([this.selected.tool({ ...structuredClone(data), signal: abort.signal }), timeout]);
      const result = await verifyToolResult(structuredClone(raw), data);
      abort.signal.throwIfAborted();
      if (result.error) throw new ExecutionError(result.error.code, result.error.message, result.error.retryable);
      if (result.status !== 'completed' || result.executionMode !== 'live') throw new Error('Tool did not complete live evidence');
      await this.store.checking(runId);
      const importJob = this.artifacts.import(candidate, outputDir, result.artifacts, abort.signal).then(async refs => {
        if (abort.signal.aborted) { await this.artifacts.discard(refs); throw new Error('Late import'); }
        return refs;
      });
      imported = await Promise.race([importJob, timeout]);
      abort.signal.throwIfAborted();
      await this.store.completeCandidate({ ...candidate, status: result.checks.every(c => c.state === 'passed') ? 'reviewable' : 'rejected',
        engine: result.engine, sourceSha256: result.sourceSha256, proposalHash: result.proposalHash, geometryHash: result.geometryHash,
        checkBundleHash: result.checkBundleHash, checks: result.checks, artifacts: imported,
        changeSummary: proposal.kind === 'python_source' ? proposal.changeSummary : 'Applied the confirmed plate dimensions.' }, abort.signal);
      imported = [];
    } catch (error) {
      await this.artifacts.discard(imported);
      const code = error instanceof ExecutionError ? ErrorCodeSchema.safeParse(error.code) : null;
      await this.store.fail(runId, safeError(abort.signal.aborted ? 'RUN_TIMEOUT' : code?.success ? code.data : 'EXECUTION_FAILED'));
    } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', listener); }
  }
}
