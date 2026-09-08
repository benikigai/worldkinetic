// Additional fixed developer inputs. Every CAD request uses the adapter's host flock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cadToolAdapter } from './adapter.js';
import { CONTRACT_VERSION, createRequirements, sha256, verifyToolResult, type ToolInput } from '../shared/contracts-v2.js';

const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'worldkinetics-source-cases-'));
const reference = path.resolve('examples/plate/revised/plate-50x35x5.step');
const referenceHash = '9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3';
const base = "from build123d import *\np = import_step('/input/reference.step')\n";
const save = "export_step(p, '/out/candidate.step')\n";
let counter = 0;

async function run(source: string, resize = false) {
  const id = ++counter;
  const requirements = await createRequirements({ designId: 'source_edge_cases', requirementsVersion: 1,
    setupId: resize ? 'resize_centered_v1' : 'tactile_feature_v1', ...(resize ? { lengthMm: 36 } : {}) });
  const request: ToolInput = {
    contractVersion: CONTRACT_VERSION, runId: `edge_run_${id}`, requestId: `edge_request_${id}`,
    designId: requirements.designId, inputRevisionId: 'baseline_50', outputRevisionId: `edge_candidate_${id}`,
    attemptId: `edge_attempt_${id}`, units: 'mm', requirements,
    registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
    proposal: { kind: 'python_source', source, changeSummary: 'Fixed developer source edge case' },
    outputDir: path.join(scratch, `out-${id}`), remainingBudgetMs: 60000,
    inputArtifacts: [{ artifactId: 'reference_step', revisionId: 'baseline_50', kind: 'reference', units: 'mm',
      path: reference, sha256: referenceHash }], signal: new AbortController().signal,
  };
  const result = await cadToolAdapter(request);
  const { signal: _, ...data } = request;
  await verifyToolResult(result, data);
  return result;
}

test('resize source accepts exactly 65536 UTF-8 bytes and delivers those bytes unchanged', { timeout: 75000 }, async () => {
  const program = `from build123d import *
p = Box(36,35,5,align=(Align.MIN,Align.MIN,Align.MIN))
for x in (8,28):
    p -= Pos(x,17.5,0) * Cylinder(3,5,align=(Align.CENTER,Align.CENTER,Align.MIN))
` + save + '# café ';
  const source = program + ' '.repeat(65536 - Buffer.byteLength(program));
  const result = await run(source, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every(c => c.state === 'passed'));
  assert.equal(result.sourceSha256, await sha256(source));
  for (const artifact of result.artifacts.filter(a => a.kind === 'source' || a.kind === 'editable')) {
    assert.equal(await fs.readFile(artifact.path, 'utf8'), source);
  }
});

test('missing addition and missing baseline retain all nine measured checks', { timeout: 150000 }, async () => {
  for (const source of ["from shutil import copyfile\ncopyfile('/input/reference.step', '/out/candidate.step')\n", base + 'p = Pos(20,25,10) * Box(8,3,2)\n' + save]) {
    const result = await run(source);
    assert.equal(result.status, 'completed');
    assert.equal(result.checks.length, 9);
    assert.equal(result.checks.find(c => c.checkId === 'feature.requested_change')?.state, 'failed');
    assert.equal(result.checks.find(c => c.checkId === 'geometry.requested_dimensions')?.state, 'failed');
  }
});

test('sub-1 mm3 raised ring fails strict volume despite meeting all three spans', { timeout: 75000 }, async () => {
  const result = await run(base + `ring = Box(8,3,2,align=(Align.MIN,Align.MIN,Align.MIN))
ring -= Pos(0.01,0.01,0) * Box(7.98,2.98,2,align=(Align.MIN,Align.MIN,Align.MIN))
p += Pos(21,26,5) * ring
` + save);
  assert.equal(result.status, 'completed');
  const check = result.checks.find(c => c.checkId === 'feature.requested_change');
  assert.equal(check?.state, 'failed');
  const measured = (check?.measured as { measurement: { addedVolumeMm3: number; addedSpansMm: number[] } }).measurement;
  assert.ok(measured.addedVolumeMm3 > 0 && measured.addedVolumeMm3 < 1);
  for (const [i, span] of [8, 3, 2].entries()) assert.ok(Math.abs(measured.addedSpansMm[i]! - span) < 0.01);
});

test('extra disconnected solid is a measured rejection; missing output is infrastructure failure', { timeout: 75000 }, async () => {
  const result = await run(base + 'p += Pos(25,27.5,5) * extrude(SlotOverall(10,4), amount=2)\np += Pos(70,0,0) * Box(1,1,1)\n' + save);
  assert.equal(result.status, 'completed');
  assert.equal(result.checks.find(c => c.checkId === 'geometry.valid_single_solid')?.state, 'failed');
  const missing = await run('pass\n');
  assert.equal(missing.status, 'failed');
  assert.equal(missing.error?.code, 'EXPORT_FAILED');
  assert.deepEqual(missing.checks, []);
  assert.deepEqual(missing.artifacts, []);
});


test('a generated feature may contain its own tunnel while preserving the two base bores', { timeout: 75000 }, async () => {
  const result = await run(base + `feature = Pos(21,26,5) * Box(8,3,2,align=(Align.MIN,Align.MIN,Align.MIN))
feature -= Pos(23,25,5.5) * Box(4,5,1,align=(Align.MIN,Align.MIN,Align.MIN))
p += feature
` + save);
  assert.equal(result.status, 'completed');
  assert.ok(result.checks.every(c => c.state === 'passed'), JSON.stringify(result.checks.filter(c => c.state !== 'passed')));
});
