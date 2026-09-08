import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ErrorCodeSchema, ProviderProposalSchema, safeError, sha256, verifyCandidateEvidence, verifyToolResult,
  type Artifact, type Candidate, type DispatchReferenceArtifact, type InputArtifact, type ProviderProposal,
  type Requirements, type Run, type ToolAdapter } from '../shared/contracts.js';
import { ExecutionError } from './errors.js';
import type { RunStore } from './store.js';
import type { SourceRequest } from './responses-source.js';
import { ArtifactStore } from './artifacts.js';
import { verifyDispatchArtifacts, verifyFile } from './dispatch-integrity.js';

type PlannerContext = Pick<SourceRequest, 'acceptedSource' | 'feedback'>;
export interface Planner {
  identity: { name: string; requestedModel: string; reportedModel: string | null };
  propose(run: Run, signal: AbortSignal, requirements: Requirements, context?: PlannerContext): Promise<ProviderProposal>;
}
export interface SelectedOperation {
  name: string;
  parameters: z.ZodType<Record<string, number>>;
  planner: Planner;
  tool: ToolAdapter;
  baselineArtifacts?: InputArtifact[];
  baselineOnly?: boolean;
  referenceArtifact?: DispatchReferenceArtifact;
  verifyReference?: () => Promise<void>;
  retryRejected?: boolean;
}
export class Executor {
  constructor(readonly store: RunStore, readonly artifacts: ArtifactStore, readonly runtimeDir: string,
    readonly selected: SelectedOperation | null, readonly timeoutMs = 120_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180_000) throw new Error('Invalid run deadline.');
  }
  private async source(candidate: Candidate) {
    const artifact = candidate.artifacts.find(a => a.kind === 'source' && a.sha256 === candidate.sourceSha256);
    if (!artifact) throw new Error('Missing checked source');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await this.artifacts.read(artifact));
    if (await sha256(source) !== candidate.sourceSha256) throw new Error('Source identity mismatch');
    return { source, sha256: artifact.sha256 };
  }
  async execute(runId: string): Promise<void> {
    const selected = this.selected;
    if (!selected || this.store.getRun(runId).status !== 'queued') return;
    const abort = new AbortController(), deadline = Date.now() + this.timeoutMs;
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let listener!: () => void;
    const timeout = new Promise<never>((_, reject) => {
      listener = () => reject(new Error('Deadline exceeded'));
      abort.signal.addEventListener('abort', listener, { once: true });
    });
    const guard = () => {
      if (Date.now() >= deadline) abort.abort();
      abort.signal.throwIfAborted();
    };
    const bounded = async <T>(job: Promise<T>): Promise<T> => {
      const result = await Promise.race([job, timeout]); guard(); return result;
    };
    let attemptId = this.store.getRun(runId).activeAttemptId!;
    let imported: Artifact[] = [];
    try {
      while (this.store.isCurrentRun(runId)) {
        guard();
        const run = this.store.getRun(runId);
        attemptId = run.activeAttemptId!;
        const candidate = this.store.getCandidate(run.candidateRevisionIds[run.attemptIds.indexOf(attemptId)]!);
        const current = () => this.store.isCurrentRun(runId, attemptId);
        if (selected.baselineOnly && (run.inputRevisionId !== this.store.getDesign()?.baselineRevisionId
          || this.store.getDesign()?.acceptedRevisionId !== null)) throw new ExecutionError('TOOL_UNAVAILABLE', 'The engineering runtime is unavailable.');
        await bounded(this.store.planning(runId, attemptId));
        const accepted = await bounded(this.store.verifiedAcceptedInput(runId, attemptId));
        const inputArtifacts: InputArtifact[] = accepted ? accepted.artifacts.map(a => ({ artifactId: a.artifactId, revisionId: a.revisionId,
          kind: a.kind, units: a.units, path: path.resolve(this.artifacts.root, a.artifactId), sha256: a.sha256 })) : structuredClone(selected.baselineArtifacts ?? []);
        if (selected.verifyReference) await bounded(selected.verifyReference());
        for (const a of inputArtifacts) await bounded(verifyFile(a.path, a.sha256));
        const context: PlannerContext = { acceptedSource: accepted ? { revisionId: accepted.revisionId, ...await bounded(this.source(accepted)) } : null, feedback: null };
        const previousRevision = run.candidateRevisionIds[run.attemptIds.indexOf(attemptId) - 1];
        if (previousRevision) {
          const previous = await bounded(verifyCandidateEvidence(this.store.getCandidate(previousRevision)));
          if (previous.status !== 'rejected') throw new Error('Repair requires checked rejection evidence');
          const source = await bounded(this.source(previous));
          context.feedback = { attemptId: previous.attemptId, source: source.source, sourceSha256: source.sha256,
            checks: previous.checks, error: previous.error };
        }
        guard();
        if (!current()) return;
        const proposal = ProviderProposalSchema.parse(await bounded(selected.planner.propose(
          structuredClone(run), abort.signal, structuredClone(candidate.requirements), structuredClone(context))));
        guard();
        if (!current()) return;
        if (proposal.kind === 'numeric_operation') {
          if (proposal.operation.name !== selected.name) throw new Error('Unsupported operation');
          selected.parameters.parse(proposal.operation.parameters);
        }
        const outputDir = path.join(this.runtimeDir, 'runs', runId, 'attempts', attemptId, 'tool-output');
        const data = await bounded(verifyDispatchArtifacts({ contractVersion: run.contractVersion, runId, requestId: run.requestId, designId: run.designId,
          inputRevisionId: run.inputRevisionId, outputRevisionId: candidate.revisionId, attemptId,
          units: run.units, requirements: candidate.requirements, registryCanonicalJson: candidate.requirements.registryCanonicalJson,
          setupCanonicalJson: candidate.requirements.setupCanonicalJson, proposal, outputDir, deadline: new Date(deadline).toISOString(),
          inputArtifacts, ...(selected.referenceArtifact ? { referenceArtifact: structuredClone(selected.referenceArtifact) } : {}) }));
        await bounded(this.store.verifiedAcceptedInput(runId, attemptId));
        if (selected.verifyReference) await bounded(selected.verifyReference());
        await bounded(this.store.running(runId, attemptId));
        await bounded(mkdir(path.dirname(outputDir), { recursive: true, mode: 0o700 }));
        guard();
        if (!current()) return;
        const raw = await bounded(selected.tool({ ...structuredClone(data), signal: abort.signal }));
        if (!current()) return;
        const result = await bounded(verifyToolResult(structuredClone(raw), data));
        if (result.error) throw new ExecutionError(result.error.code, result.error.message, result.error.retryable);
        if (result.status !== 'completed' || result.executionMode !== 'live') throw new Error('Tool did not complete live evidence');
        await bounded(this.store.checking(runId, attemptId));
        const importJob = this.artifacts.import(candidate, outputDir, result.artifacts, abort.signal).then(async refs => {
          if (abort.signal.aborted || !current()) { await this.artifacts.discard(refs); throw new Error('Late import'); }
          imported = refs;
          return refs;
        });
        imported = await bounded(importJob);
        guard();
        await this.store.completeCandidate({ ...candidate, status: result.checks.every(c => c.state === 'passed') ? 'reviewable' : 'rejected',
          engine: result.engine, sourceSha256: result.sourceSha256, proposalHash: result.proposalHash, geometryHash: result.geometryHash,
          checkBundleHash: result.checkBundleHash, checks: result.checks, artifacts: imported,
          changeSummary: proposal.kind === 'python_source' ? proposal.changeSummary : 'Applied the confirmed plate dimensions.' },
        abort.signal, { retryRejected: selected.retryRejected });
        imported = [];
        // Completion may atomically reserve the next attempt. It has the same deadline.
        attemptId = this.store.getRun(runId).activeAttemptId ?? attemptId;
      }
    } catch (error) {
      const code = error instanceof ExecutionError ? ErrorCodeSchema.safeParse(error.code) : null;
      await this.store.fail(runId, safeError(abort.signal.aborted ? 'RUN_TIMEOUT' : code?.success ? code.data : 'EXECUTION_FAILED'), attemptId);
      const cleanup = this.artifacts.discard(imported);
      // Cleanup still runs after timeout, but cannot extend the request budget or register evidence.
      await Promise.race([cleanup, timeout]).catch(() => undefined);
    } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', listener); }
  }
}
