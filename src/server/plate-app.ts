import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createRequirements, type Design, type ToolAdapter } from '../shared/contracts.js';
import { cadToolAdapter } from '../tools/adapter.js';
import { createApp } from './app.js';
import { RunStore } from './store.js';
import { ResponsesAstraPlanner } from './responses-astra.js';
import { SavedPlateReference } from './reference.js';
import type { SelectedOperation } from './execution.js';

export async function createPlateApplication(options: {
  runtimeDir: string; apiKey?: string; fetchImpl?: typeof fetch; tool?: ToolAdapter;
}) {
  await mkdir(options.runtimeDir, { recursive: true, mode: 0o700 });
  const runtimeDir = await realpath(options.runtimeDir);
  const lockPath = path.join(runtimeDir, 'instance.lock');
  let lock: number;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch { throw new Error('Runtime directory is locked. Use a separate WORLDKINETICS_RUNTIME_DIR.'); }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    closeSync(lock);
    unlinkSync(lockPath);
    process.removeListener('exit', release);
  };
  process.once('exit', release);
  try {
    writeFileSync(lock, String(process.pid));
    const requirements = await createRequirements({ designId: 'plate', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 50 });
    const design: Design = { designId: 'plate', label: 'Plate integration reference', units: 'mm', stateVersion: 0,
      referenceId: requirements.referenceId, referenceHash: requirements.referenceHash, setupId: requirements.setupId, setupHash: requirements.setupHash,
      baselineRevisionId: 'baseline_50', activeRequirementsVersion: 1, acceptedRevisionId: null, acceptedRequirementsMatch: false,
      selectedCandidateRevisionId: null, activeRunId: null };
    // RunStore rejects legacy sessions before any baseline files are registered.
    const store = new RunStore(runtimeDir, design, requirements);
    const reference = await SavedPlateReference.register(runtimeDir, requirements);
    const planner = options.apiKey?.trim() ? new ResponsesAstraPlanner({ runtimeDir, apiKey: options.apiKey, fetchImpl: options.fetchImpl }) : null;
    const selected: SelectedOperation | null = planner ? {
      name: 'resize_plate', parameters: z.object({ lengthMm: z.number().finite().min(26).max(200) }).strict(),
      planner, tool: options.tool ?? cadToolAdapter, baselineOnly: true, baselineArtifacts: reference.inputArtifacts(),
    } : null;
    const server = createApp(store, runtimeDir, selected, 180_000, { reference });
    server.once('close', release);
    return { server, store, planner, reference, runtimeDir };
  } catch (error) { release(); throw error; }
}
