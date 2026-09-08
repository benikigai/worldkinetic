/** Live cancellation probe. Run serially with other CAD checks. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CONTRACT_VERSION, createRequirements, verifyToolResult } from '../shared/contracts-v2.js';
import { cadToolAdapter } from './adapter.js';

const exec = promisify(execFile);
async function containers(): Promise<string[]> {
  const { stdout } = await exec('docker', ['container', 'ls', '-a', '--format', '{{.Names}}'], { timeout: 5000 });
  return stdout.trim().split('\n').filter(name => name.startsWith('wk-cad-'));
}

assert.deepEqual(await containers(), [], 'Run only when no CAD containers are active.');
const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wk-adapter-cancel-'));
const requirements = await createRequirements({ designId: 'cancel_probe', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
const input = {
  contractVersion: CONTRACT_VERSION, runId: 'cancel_run', requestId: 'cancel_request', designId: requirements.designId,
  inputRevisionId: 'baseline_50', outputRevisionId: 'cancel_candidate', attemptId: 'cancel_attempt', units: 'mm' as const,
  requirements, registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
  proposal: { kind: 'numeric_operation' as const, operation: { name: 'resize_plate' as const, parameters: { lengthMm: 36 } } },
  outputDir: path.join(scratch, 'output'), remainingBudgetMs: 60000,
  inputArtifacts: [{ artifactId: 'reference_step', revisionId: 'baseline_50', kind: 'reference' as const, units: 'mm' as const,
    path: fileURLToPath(new URL('../../examples/plate/revised/plate-50x35x5.step', import.meta.url)), sha256: requirements.referenceHash }],
};
const controller = new AbortController();
const operation = cadToolAdapter({ ...input, signal: controller.signal });
try {
  const end = performance.now() + 15000;
  let observed: string[] = [];
  while (performance.now() < end) {
    const { stdout } = await exec('docker', ['ps', '--format', '{{.Names}}'], { timeout: 5000 });
    observed = stdout.trim().split('\n').filter(name => name.startsWith('wk-cad-generator-'));
    if (observed.length) break;
    await delay(50);
  }
  assert.equal(observed.length, 1, 'Observe a running generator before cancelling.');
  controller.abort();
  const result = await operation;
  await verifyToolResult(result, input);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'RUN_TIMEOUT');
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.checks, []);
  assert.deepEqual(await containers(), [], 'Adapter returned before cleanup completed.');
  await assert.rejects(fs.access(input.outputDir));
  process.stdout.write('Active adapter cancellation waited for container removal and returned RUN_TIMEOUT without artifacts.\n');
} finally {
  controller.abort();
  await operation;
  await fs.rm(scratch, { recursive: true, force: true });
}
