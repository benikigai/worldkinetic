import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CodexAstraPlanner } from '../src/server/astra.js';
import { CONTRACT_VERSION, type Run } from '../src/shared/contracts.js';

const runtimeDir = path.resolve(process.env.WORLDKINETICS_RUNTIME_DIR ?? '.runtime/provider-probes');
const run: Run = {
  contractVersion: CONTRACT_VERSION, runId: `probe_${randomUUID()}`, requestId: `probe_${randomUUID()}`,
  designId: 'provider_probe', inputRevisionId: 'probe_revision_0', outputRevisionId: 'probe_revision_1',
  units: 'mm', instruction: 'Return backend_probe with value equal to 2.',
  status: 'planning', executionMode: 'live', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  operation: null, checks: [], artifacts: [], evidenceApplicability: 'unavailable', error: null, provider: null,
};
const planner = new CodexAstraPlanner({
  runtimeDir, operationName: 'backend_probe', parameters: z.object({ value: z.number().min(2).max(2) }).strict(),
  context: 'Provider interface verification only. No product design, CAD edits, checks, or artifact generation is authorized by this probe.',
});
const started = Date.now();
try {
  const operation = await planner.propose(run, AbortSignal.timeout(120_000));
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
