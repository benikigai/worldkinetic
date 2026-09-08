// TOOLS-03 acceptance setup draft, OUTSIDE_WRAPPER. Commit before implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cadToolAdapter } from '../../src/tools/adapter.js';
import { CONTRACT_VERSION, createRequirements, verifyToolResult, sha256, type ToolInput, type ToolResult } from '../../src/shared/contracts-v2.js';

const exec = promisify(execFile);
const parent = path.join(process.cwd(), '.runtime/tools/source-acceptance');
await fs.mkdir(parent, { recursive: true });
const scratch = await fs.mkdtemp(path.join(parent, 'run-'));
let counter = 0;
const ref = path.join(process.cwd(), 'examples/plate/revised/plate-50x35x5.step');
const referenceHash = '9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3';
const base = `from build123d import *
from pathlib import Path
assert not Path('/input/verify.py').exists()
assert not Path('/input/config.json').exists()
assert not Path('/input/requirements.json').exists()
p = import_step('/input/reference.step')
`;
const feature = `p = p + Pos(25,27.5,5) * extrude(SlotOverall(10,4), amount=2)
`;
const save = `export_step(p, '/out/candidate.step')
`;
const good = base + feature + save;

async function input(source: string): Promise<ToolInput> {
  const id = ++counter;
  const requirements = await createRequirements({ designId: 'source_test_plate', requirementsVersion: 1, setupId: 'tactile_feature_v1' });
  return {
    contractVersion: CONTRACT_VERSION, runId: `source_run_${id}`, requestId: `source_request_${id}`, designId: requirements.designId,
    inputRevisionId: 'baseline_50', outputRevisionId: `source_candidate_${id}`, attemptId: `source_attempt_${id}`, units: 'mm',
    requirements, registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
    proposal: { kind: 'python_source', source, changeSummary: 'Synthetic generated-source engineering test' },
    outputDir: path.join(scratch, `out-${id}`), remainingBudgetMs: 60000,
    inputArtifacts: [{ artifactId: 'reference_step', revisionId: 'baseline_50', kind: 'reference', units: 'mm', path: ref, sha256: referenceHash }],
    signal: new AbortController().signal,
  };
}

async function run(source: string): Promise<ToolResult> {
  const request = await input(source);
  const result = await cadToolAdapter(request);
  const { signal: _, ...data } = request;
  await verifyToolResult(result, data);
  if (result.status === 'completed') {
    assert.equal(result.checks.length, 9);
    assert.equal(result.sourceSha256, await sha256(source));
    for (const artifact of result.artifacts) assert.equal(await sha256(await fs.readFile(artifact.path)), artifact.sha256);
  }
  return result;
}

test('arbitrary source produces two distinct real features with nine measured checks', { timeout: 150000 }, async () => {
  const rounded = await run(good);
  assert.equal(rounded.status, 'completed');
  assert.ok(rounded.checks.every(c => c.state === 'passed'), JSON.stringify(rounded.checks.filter(c => c.state !== 'passed')));
  const rectangular = await run(base + `p = p + Pos(21,26,5) * Box(8,3,2, align=(Align.MIN,Align.MIN,Align.MIN))\n` + save);
  assert.equal(rectangular.status, 'completed');
  assert.ok(rectangular.checks.every(c => c.state === 'passed'));
  assert.notEqual(rounded.sourceSha256, rectangular.sourceSha256);
  assert.notEqual(rounded.geometryHash, rectangular.geometryHash);
  await fs.writeFile(path.join(scratch, 'rounded-result.json'), JSON.stringify(rounded, null, 2));
});

test('full-height tiny cap fails even below the difference-volume allowance', { timeout: 75000 }, async () => {
  const result = await run(base + feature + `p = p + Pos(15,17.5,5) * Cylinder(3.001,0.0001,align=(Align.CENTER,Align.CENTER,Align.MIN))\n` + save);
  assert.equal(result.status, 'completed');
  assert.equal(result.checks.find(c => c.checkId === 'holes.layout')?.state, 'failed');
  assert.equal(result.checks.find(c => c.checkId === 'export.stl_reopen')?.state, 'failed');
});

test('baseline removal and out-of-box addition do not pass feature requirements', { timeout: 150000 }, async () => {
  const removed = await run(base + feature + `p = p - Pos(18.5,17.5,4) * Box(1,1,2)\n` + save);
  assert.equal(removed.status, 'completed');
  assert.equal(removed.checks.find(c => c.checkId === 'interface.protected_region')?.state, 'failed');
  const outside = await run(base + `p = p + Pos(0,25,5) * Box(10,5,2,align=(Align.MIN,Align.MIN,Align.MIN))\n` + save);
  assert.equal(outside.status, 'completed');
  assert.equal(outside.checks.find(c => c.checkId === 'feature.requested_change')?.state, 'failed');
});

test('candidate cannot write reference or access network while valid geometry still succeeds', { timeout: 75000 }, async () => {
  const checks = `import socket
try:
    Path('/input/reference.step').write_text('changed')
    raise AssertionError('reference writable')
except OSError: pass
try:
    s=socket.create_connection(('1.1.1.1',443),timeout=1)
    s.close()
    raise AssertionError('network reachable')
except OSError: pass
`;
  const result = await run(base + checks + feature + save);
  assert.equal(result.status, 'completed');
  assert.ok(result.checks.every(c => c.state === 'passed'));
  assert.equal(await sha256(await fs.readFile(ref)), referenceHash);
});

test('forged reports, symlinks, partial execution, syntax and excess outputs fail closed', { timeout: 90000 }, async () => {
  const sources = [
    good + `Path('/out/checks.json').write_text('{"state":"passed"}')\n`,
    `import os\nos.symlink('/input/reference.step','/out/candidate.step')\n`,
    good + `raise RuntimeError('after valid output')\n`,
    `this is not valid Python !\n`,
    `from pathlib import Path\nPath('/out/candidate.step').write_bytes(b'x'*(26*1024*1024))\n`,
  ];
  for (const source of sources) {
    const result = await run(source);
    assert.notEqual(result.status, 'completed');
    assert.equal(result.artifacts.length, 0);
    assert.equal(result.checks.length, 0);
    assert.ok(result.error);
    assert.notEqual(result.error?.code, 'TOOL_UNAVAILABLE');
  }
});

test('source byte limit is enforced before execution', async () => {
  const request = await input('#' + '😀'.repeat(20000));
  await assert.rejects(cadToolAdapter(request));
});

test('source timeout and active abort remove every owned container', { timeout: 30000 }, async () => {
  const names = async () => (await exec('docker',['ps','-a','--filter','name=wk-cad-','--format','{{.Names}}'])).stdout.trim().split('\n').filter(Boolean).sort();
  const before = await names();
  const source = `import subprocess,sys,time
subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True)
time.sleep(120)
`;
  const request = await input(source);
  const timed = await cadToolAdapter({ ...request, remainingBudgetMs: 1800 });
  assert.equal(timed.error?.code, 'RUN_TIMEOUT');
  assert.deepEqual(await names(), before);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1800);
  try {
    const cancelled = await cadToolAdapter({ ...await input(source), signal: abort.signal });
    assert.equal(cancelled.error?.code, 'RUN_TIMEOUT');
    assert.equal(cancelled.artifacts.length, 0);
    assert.deepEqual(await names(), before);
  } finally { clearTimeout(timer); }
});
