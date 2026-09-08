import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cadToolAdapter } from '../../src/tools/adapter.js';
import { CONTRACT_VERSION, createRequirements, verifyToolResult, ToolResultSchema, sha256, type ToolInput } from '../../src/shared/contracts-v2.js';

const root = process.cwd();
let counter = 0;
const parent = path.join(root, '.runtime/tools/adapter-acceptance');
await fs.mkdir(parent, { recursive: true });
const scratch = await fs.mkdtemp(path.join(parent, 'run-'));
const ref = path.join(root, 'examples/plate/revised/plate-50x35x5.step');
const referenceHash = '9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3';

async function input(length: number, version = 1): Promise<ToolInput> {
  const id = ++counter;
  const requirements = await createRequirements({ designId: 'tools_test_plate', requirementsVersion: version, setupId: 'resize_centered_v1', lengthMm: length });
  return {
    contractVersion: CONTRACT_VERSION, runId: `run_${id}`, requestId: `request_${id}`, designId: requirements.designId,
    inputRevisionId: 'baseline_50', outputRevisionId: `candidate_${id}`, attemptId: `attempt_${id}`, units: 'mm',
    requirements, registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
    proposal: { kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: length } } },
    outputDir: path.join(scratch, `out-${id}`), remainingBudgetMs: 60000,
    inputArtifacts: [{ artifactId: 'reference_step', revisionId: 'baseline_50', kind: 'reference', units: 'mm', path: ref, sha256: referenceHash }],
    signal: new AbortController().signal,
  };
}

test('real measured results satisfy dispatched v2 bindings and exact artifact bytes', { timeout: 150000 }, async () => {
  for (const [length, version, state] of [[30, 1, 'failed'], [36, 2, 'passed']] as const) {
    const request = await input(length, version);
    const result = await cadToolAdapter(request);
    const { signal: _, ...data } = request;
    await verifyToolResult(result, data);
    assert.equal(result.status, 'completed');
    assert.equal(result.executionMode, 'live');
    assert.equal(result.requirementsVersion, version);
    assert.equal(result.checks.length, 7);
    assert.equal(result.checks.find(c => c.checkId === 'margin.end_material')?.state, state);
    for (const check of result.checks) {
      if (check.checkId !== 'margin.end_material') assert.equal(check.state, 'passed');
      assert.equal(check.geometryHash, result.geometryHash);
      assert.equal(check.setupHash, request.requirements.setupHash);
    }
    const pairs = result.checks.find(c => c.checkId === 'margin.end_material')?.diagnostics?.pointPairs;
    assert.equal(pairs?.length, 2);
    assert.ok(result.artifacts.some(a => a.kind === 'source'));
    assert.ok(result.artifacts.some(a => a.kind === 'editable'));
    for (const artifact of result.artifacts) {
      assert.ok(path.resolve(artifact.path).startsWith(path.resolve(request.outputDir) + path.sep));
      assert.equal((await fs.lstat(artifact.path)).isSymbolicLink(), false);
      const bytes = await fs.readFile(artifact.path);
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(await sha256(bytes), artifact.sha256);
      assert.equal(artifact.executionMode, 'live');
    }
    await fs.writeFile(path.join(scratch, `result-${length}.json`), JSON.stringify(result, null, 2));
  }
  assert.equal(await sha256(await fs.readFile(ref)), referenceHash);
});

test('canonical mismatch and unsupported validator fail before CAD', async () => {
  const request = await input(36);
  await assert.rejects(cadToolAdapter({ ...request, setupCanonicalJson: request.setupCanonicalJson + ' ' }));
  const unknown = await createRequirements({ designId: request.designId, requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36, validatorVersion: 'unknown_validator' });
  const result = await cadToolAdapter({ ...request, requirements: unknown, setupCanonicalJson: unknown.setupCanonicalJson, registryCanonicalJson: unknown.registryCanonicalJson });
  assert.notEqual(result.status, 'completed');
  assert.equal(result.checks.length, 0);
  assert.ok(result.error);
});

test('mismatched input bytes cannot acquire successful evidence', async () => {
  const request = await input(36);
  const fake = path.join(scratch, 'wrong-reference.step');
  await fs.writeFile(fake, 'not CAD');
  request.inputArtifacts[0]!.path = fake;
  const result = await cadToolAdapter(request);
  assert.notEqual(result.status, 'completed');
  assert.equal(result.error?.code, 'EVIDENCE_CONFLICT');
  assert.equal(result.artifacts.length, 0);
});

test('earlier absolute deadline and pre-abort are respected', async () => {
  const request = await input(36);
  const expired = await cadToolAdapter({ ...request, deadline: '2020-01-01T00:00:00.000Z' });
  assert.equal(expired.error?.code, 'RUN_TIMEOUT');
  const aborted = new AbortController(); aborted.abort();
  const result = await cadToolAdapter({ ...await input(36), signal: aborted.signal });
  assert.equal(result.error?.code, 'RUN_TIMEOUT');
  assert.equal(result.artifacts.length, 0);
});

test('host lock contention consumes budget before any Docker invocation', { timeout: 10000 }, async () => {
  const lockPath = path.join(scratch, 'shared-cad.lock');
  const held = spawn('python3', ['-c', 'import fcntl,os,sys;f=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR,0o600);fcntl.flock(f,fcntl.LOCK_EX);print("held",flush=True);sys.stdin.read(1)', lockPath]);
  await once(held.stdout, 'data');
  const bin = path.join(scratch, 'bin'); await fs.mkdir(bin);
  const marker = path.join(scratch, 'docker-was-called');
  await fs.writeFile(path.join(bin, 'docker'), `#!/usr/bin/env python3\nfrom pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('called')\nraise SystemExit(99)\n`, { mode: 0o755 });
  const oldLock = process.env.WORLDKINETICS_CAD_LOCK_PATH;
  const oldPath = process.env.PATH;
  try {
    process.env.WORLDKINETICS_CAD_LOCK_PATH = lockPath;
    process.env.PATH = `${bin}:${oldPath}`;
    const result = await cadToolAdapter({ ...await input(36), remainingBudgetMs: 500 });
    assert.equal(result.error?.code, 'RUN_TIMEOUT');
    await assert.rejects(fs.access(marker));
  } finally {
    if (oldLock === undefined) delete process.env.WORLDKINETICS_CAD_LOCK_PATH; else process.env.WORLDKINETICS_CAD_LOCK_PATH = oldLock;
    process.env.PATH = oldPath;
    held.stdin.end('x'); await once(held, 'close');
  }
});

test('fixture uses the same v2 shape with explicit fixture provenance', async () => {
  const fixture = ToolResultSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'fixtures/tools/plate-v2-result.fixture.json'), 'utf8')));
  assert.equal(fixture.executionMode, 'fixture');
  assert.ok(fixture.checks.every(c => c.executionMode === 'fixture'));
  assert.ok(fixture.artifacts.every(a => a.executionMode === 'fixture'));
});
