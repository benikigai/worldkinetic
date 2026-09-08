import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createHandleRequirements, type Design, type ToolAdapter } from '../shared/contracts.js';
import { cadToolAdapter } from '../tools/adapter.js';
import { createApp } from './app.js';
import { RunStore } from './store.js';
import { ResponsesSourcePlanner } from './responses-source.js';
import { SavedHandleReference, type HandleReferenceFiles } from './handle-reference.js';
import type { SelectedOperation } from './execution.js';

export async function createHandleApplication(options: {
  runtimeDir: string; referenceFiles: HandleReferenceFiles; apiKey?: string; fetchImpl?: typeof fetch; tool?: ToolAdapter; timeoutMs?: number;
}) {
  await mkdir(options.runtimeDir, { recursive: true, mode: 0o700 });
  if ((await lstat(options.runtimeDir)).isSymbolicLink()) throw new Error('Runtime directory cannot be a symlink.');
  const runtimeDir = await realpath(options.runtimeDir);
  const lockPath = path.join(runtimeDir, 'instance.lock');
  let lock: number;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch { throw new Error('Runtime directory is locked. Use a separate WORLDKINETICS_RUNTIME_DIR.'); }
  let released = false;
  const release = () => {
    if (released) return;
    released = true; closeSync(lock); unlinkSync(lockPath); process.removeListener('exit', release);
  };
  process.once('exit', release);
  try {
    writeFileSync(lock, String(process.pid));
    const reference = await SavedHandleReference.register(runtimeDir, options.referenceFiles);
    const requirements = await createHandleRequirements({ designId: 'handle', requirementsVersion: 1,
      setupId: 'handle_initial_v1', reference: reference.descriptor() });
    const design: Design = { designId: 'handle', label: 'Handle mount reference', units: 'mm', stateVersion: 0,
      referenceId: requirements.referenceId, referenceHash: requirements.referenceHash, setupId: requirements.setupId, setupHash: requirements.setupHash,
      baselineRevisionId: 'handle_mount_reference_v1', activeRequirementsVersion: 1, acceptedRevisionId: null, acceptedRequirementsMatch: false,
      selectedCandidateRevisionId: null, activeRunId: null };
    const store = new RunStore(runtimeDir, design, requirements);
    const restored = store.getDesign();
    if (restored?.designId !== design.designId || restored.referenceId !== design.referenceId || restored.referenceHash !== design.referenceHash) {
      throw new Error('Runtime design or reference identity mismatch.');
    }
    await store.verifyAcceptedFiles();
    const planner = options.apiKey?.trim() ? new ResponsesSourcePlanner({ runtimeDir, apiKey: options.apiKey, fetchImpl: options.fetchImpl }) : null;
    const selected: SelectedOperation | null = planner ? {
      name: 'build_candidate', parameters: z.object({}).strict(), retryRejected: true,
      referenceArtifact: reference.dispatchArtifact(), verifyReference: async () => { await reference.describe(); },
      planner: { identity: { name: 'responses-source', requestedModel: 'gpt-6-astra', reportedModel: null },
        propose: async (run, signal, requirements, context) => {
          if (!run.activeAttemptId || !context) throw new Error('Missing source attempt context.');
          return planner.generate({ runId: run.runId, requestId: run.requestId, attemptId: run.activeAttemptId,
            designId: run.designId, inputRevisionId: run.inputRevisionId, requirements, instruction: run.instruction, ...context }, signal);
        } },
      tool: options.tool ?? cadToolAdapter,
    } : null;
    const server = createApp(store, runtimeDir, selected, options.timeoutMs ?? 180_000, { reference });
    server.once('close', release);
    return { server, store, planner, reference, runtimeDir };
  } catch (error) { release(); throw error; }
}
