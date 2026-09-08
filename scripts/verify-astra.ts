import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CodexAstraPlanner } from '../src/server/astra.js';
import { CONTRACT_VERSION, createRequirements, type Run } from '../src/shared/contracts.js';

const runtimeDir = path.resolve(process.env.WORLDKINETICS_RUNTIME_DIR ?? '.runtime/provider-probes');
const requirements = await createRequirements({ designId: 'provider_probe', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
const run: Run = {
  contractVersion: CONTRACT_VERSION, runId: `probe_${randomUUID()}`, requestId: `probe_${randomUUID()}`,
  designId: 'provider_probe', inputRevisionId: 'probe_revision_0', requirementsVersion: 1, requirementsId: requirements.requirementsId, registryId: requirements.registryId, registryHash: requirements.registryHash, setupId: requirements.setupId, setupHash: requirements.setupHash, referenceHash: requirements.referenceHash, validatorVersion: requirements.validatorVersion,
  units: 'mm', instruction: 'Return resize_plate with lengthMm equal to 36. This is a provider-only probe.',
  status: 'planning', executionMode: 'live', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  attemptIds: ['probe_attempt'], candidateRevisionIds: ['probe_revision_1'], activeAttemptId: 'probe_attempt', error: null,
};
const planner = new CodexAstraPlanner({
  runtimeDir, operationName: 'resize_plate', parameters: z.object({ lengthMm: z.literal(36) }).strict(),
  context: 'Provider interface verification only. No product design, CAD edits, checks, or artifact generation is authorized by this probe.',
});
const started = Date.now();
try {
  const operation = await planner.propose(run, AbortSignal.timeout(120_000), requirements);
  const evidence = {
    kind: 'provider-interface-probe', contractVersion: CONTRACT_VERSION,
    runId: run.runId, ...planner.identity, elapsedMs: Date.now() - started,
    operation, cadExecuted: false, completedAt: new Date().toISOString(),
  };
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(path.join(runtimeDir, `${run.runId}.json`), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Provider probe failed');
  process.exitCode = 1;
}
