// Preregistered independent acceptance. Fixed developer source is not product generation.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cadToolAdapter } from '../../src/tools/adapter.js';
import { createHandleReference } from '../../src/tools/handle_reference.js';
import {
  CONTRACT_VERSION, HANDLE_DATUM_CANONICAL_JSON, HANDLE_DATUM_SHA256,
  DispatchReferenceArtifactSchema, ToolResultSchema, createHandleRequirements,
  verifyToolInput, verifyToolResult, verifyRequirements, computeCheckBundleHash, sha256,
  type ToolInput, type ToolResult, type AcceptedInitial,
} from '../../src/shared/contracts-v2.js';

type Case = { id: string; sourceBase?: string; source?: string; append?: string; expectedFailedChecks: string[] };
type Cases = { initialSource: string; roundedInitialSource: string; refinementSource: string; saveSource: string;
  initialCases: Case[]; refinementCases: Case[] };
type Station = { xMm: number; widthMm: number; areaMm2: number; maxYMm: number; widthIncreaseMm?: number; addedAreaMm2?: number };
type Metrics = { minimumGapMm: number | null; stations: Station[]; removedVolumeMm3: number;
  thumbAddedVolumeMm3: number; outboardAddedVolumeMm3: number; protrusionMm: number; protrusionIncreaseMm: number };
const exec = promisify(execFile);
const cases = JSON.parse(await fs.readFile(new URL('./handle_cases.json', import.meta.url), 'utf8')) as Cases;
const parent = path.resolve('.runtime/tools/handle-acceptance');
await fs.mkdir(parent, { recursive: true });
const scratch = await fs.mkdtemp(path.join(parent, 'run-'));
let reference: NonNullable<ToolInput['referenceArtifact']>;
let referencePreview: { path: string; sha256: string };
let initial: ToolResult;
let accepted: AcceptedInitial;
let counter = 0;

const near = (actual: number, expected: number, tolerance = 0.01) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
function measured(result: ToolResult, id: string): Metrics {
  const check = result.checks.find(c => c.checkId === id);
  assert.ok(check, id);
  return (check.measured as unknown as { measurement: Metrics }).measurement;
}
function sourceFor(c: Case, refined: boolean): string {
  const source = c.source ?? cases[c.sourceBase as 'initialSource' | 'roundedInitialSource' | 'refinementSource'];
  assert.equal(typeof source, 'string');
  const guards = `from pathlib import Path\nimport hashlib\nassert not Path('/input/verify.py').exists()\nassert not Path('/input/config.json').exists()\nassert not Path('/input/requirements.json').exists()\nassert hashlib.sha256(Path('/input/datums.json').read_bytes()).hexdigest() == '${HANDLE_DATUM_SHA256}'\nassert Path('/input/baseline.step').exists() == ${refined ? 'True' : 'False'}\n`;
  const readonly = refined ? `for name in ('reference.step','datums.json','baseline.step'):\n    try:\n        Path('/input/'+name).write_bytes(b'changed')\n        raise AssertionError('input writable')\n    except OSError: pass\n` : '';
  return guards + readonly + (source + (c.append ?? '') + cases.saveSource)
    .replaceAll('__MOUNT_REFERENCE__', '/input/reference.step').replaceAll('__ACCEPTED_BASELINE__', '/input/baseline.step');
}
async function request(source: string, refined: boolean): Promise<ToolInput> {
  const id = ++counter;
  const ref = { referenceId: 'handle_mount_v1' as const, revisionId: 'handle_mount_reference_v1' as const,
    stepSha256: reference.sha256, datumSpecSha256: HANDLE_DATUM_SHA256 };
  const requirements = await createHandleRequirements(refined
    ? { designId: 'handle_tools_developer_test', requirementsVersion: 2, setupId: 'handle_refine_v1', reference: ref, acceptedInitial: accepted }
    : { designId: 'handle_tools_developer_test', requirementsVersion: 1, setupId: 'handle_initial_v1', reference: ref });
  const artifact = refined ? initial.artifacts.find(a => a.kind === 'export')! : null;
  const data = await verifyToolInput({
    contractVersion: CONTRACT_VERSION, runId: `handle_run_${id}`, requestId: `handle_request_${id}`,
    designId: requirements.designId, inputRevisionId: refined ? initial.outputRevisionId : 'handle_mount_reference_v1',
    outputRevisionId: `handle_candidate_${id}`, attemptId: `handle_attempt_${id}`, units: 'mm', requirements,
    registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
    proposal: { kind: 'python_source', source, changeSummary: 'Fixed developer handle acceptance input' },
    referenceArtifact: reference, inputArtifacts: artifact ? [{ artifactId: artifact.artifactId,
      revisionId: initial.outputRevisionId, kind: 'export', units: 'mm', path: artifact.path, sha256: artifact.sha256 }] : [],
    outputDir: path.join(scratch, `out-${id}`), remainingBudgetMs: 120000,
  });
  return { ...data, signal: new AbortController().signal };
}
async function run(c: Case, refined: boolean): Promise<ToolResult> {
  const source = sourceFor(c, refined), input = await request(source, refined);
  const result = await cadToolAdapter(input);
  const { signal: _, ...data } = input;
  await verifyToolResult(result, data);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.equal(result.checks.length, refined ? 9 : 8);
  assert.deepEqual(result.checks.map(c => c.checkId).sort(), [...input.requirements.requiredChecks].sort());
  assert.equal(result.sourceSha256, await sha256(source));
  for (const artifact of result.artifacts) {
    const bytes = await fs.readFile(artifact.path);
    assert.equal(await sha256(bytes), artifact.sha256);
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(artifact.executionMode, 'live');
    if (artifact.kind === 'source' || artifact.kind === 'editable') assert.equal(bytes.toString('utf8'), source);
  }
  assert.equal(result.artifacts.length, 4);
  assert.equal(await sha256(await fs.readFile(reference.path)), reference.sha256);
  assert.equal(await fs.readFile(reference.datumSpec!.path, 'utf8'), HANDLE_DATUM_CANONICAL_JSON);
  for (const id of c.expectedFailedChecks) assert.equal(result.checks.find(check => check.checkId === id)?.state, 'failed', id);
  if (!c.expectedFailedChecks.length) assert.ok(result.checks.every(c => c.state === 'passed'), JSON.stringify(result.checks.filter(c => c.state !== 'passed')));
  await fs.writeFile(path.join(scratch, c.id + '.json'), JSON.stringify(result, null, 2));
  return result;
}

before(async () => {
  const built = await createHandleReference({ outputDir: path.join(scratch, 'mount-reference'), remainingBudgetMs: 60000,
    signal: new AbortController().signal });
  reference = DispatchReferenceArtifactSchema.parse(built.referenceArtifact);
  referencePreview = built.previewArtifact;
}, { timeout: 75000 });

test('reference has exactly two independently reopened pads and exact canonical datums', { timeout: 60000 }, async () => {
  assert.equal(reference.referenceId, 'handle_mount_v1');
  assert.equal(reference.revisionId, 'handle_mount_reference_v1');
  assert.equal(reference.sha256, await sha256(await fs.readFile(reference.path)));
  assert.equal(reference.datumSpec?.sha256, HANDLE_DATUM_SHA256);
  assert.equal(await fs.readFile(reference.datumSpec!.path, 'utf8'), HANDLE_DATUM_CANONICAL_JSON);
  assert.equal(await sha256(await fs.readFile(referencePreview.path)), referencePreview.sha256);
  const { stdout } = await exec('python3', ['-B', 'tests/tools/run_handle_reference_probe.py', reference.path, referencePreview.path], { timeout: 55000 });
  const observed = JSON.parse(stdout);
  assert.equal(observed.measurement.solidCount, 2);
  near(observed.measurement.volumeMm3, 196 * Math.PI);
  assert.equal(observed.measurement.mesh.components, 2);
  assert.ok(observed.stages.every((s: {removed: boolean}) => s.removed));
  await fs.writeFile(path.join(scratch, 'reference-observed.json'), stdout);
});

for (const c of cases.initialCases) test(c.id, { timeout: 135000 }, async () => {
  const result = await run(c, false);
  if (c.id === 'valid_initial') {
    initial = result;
    const artifact = result.artifacts.find(a => a.kind === 'export')!;
    // Synthetic acceptance descriptor for adapter testing, not application/user acceptance.
    accepted = { acceptanceId: 'developer_initial_acceptance', revisionId: result.outputRevisionId,
      artifactId: artifact.artifactId, sha256: artifact.sha256, requirementsId: result.requirementsId,
      requirementsVersion: result.requirementsVersion, setupHash: result.setupHash,
      sourceSha256: result.sourceSha256!, checkBundleHash: result.checkBundleHash! };
    near(measured(result, 'handle.grip_clearance').minimumGapMm!, 25, 1e-6);
    const stations = measured(result, 'handle.grip_sections').stations;
    assert.deepEqual(stations.map(s => s.xMm), [-24,-12,0,12,24]);
    for (const s of stations) { near(s.widthMm, 10); near(s.areaMm2, 100); }
  }
  if (c.id === 'rounded_initial') {
    assert.notEqual(result.geometryHash, initial.geometryHash);
    for (const s of measured(result, 'handle.grip_sections').stations) { near(s.widthMm, 12); near(s.areaMm2, 36 * Math.PI); }
  }
});

for (const c of cases.refinementCases) test(c.id, { timeout: 135000 }, async () => {
  const result = await run(c, true), delta = measured(result, 'handle.refinement_delta');
  if (c.id === 'valid_refinement') {
    const stations = measured(result, 'handle.grip_sections').stations;
    for (const [i, expected] of [14,14,19,14,14].entries()) near(stations[i]!.widthMm, expected);
    near(delta.thumbAddedVolumeMm3, 880); near(delta.outboardAddedVolumeMm3, 384);
    near(delta.protrusionMm, 5); near(delta.protrusionIncreaseMm, 5); near(delta.removedVolumeMm3, 0);
  }
  if (c.id === 'uniform_widening') {
    near(delta.protrusionMm, 0); near(delta.outboardAddedVolumeMm3, 0);
    for (const s of delta.stations) near(s.widthIncreaseMm!, 4);
  }
  if (c.id === 'tiny_rest_spike') { near(delta.protrusionMm, 2); assert.ok(delta.outboardAddedVolumeMm3 < 5); }
  if (c.id === 'removed_initial_material') assert.ok(delta.removedVolumeMm3 > 0.01);
});

test('datum and accepted-baseline byte mismatches cannot produce evidence', { timeout: 30000 }, async () => {
  const source = sourceFor(cases.refinementCases[0]!, true);
  const datum = path.join(scratch, 'wrong-datums.json');
  await fs.writeFile(datum, HANDLE_DATUM_CANONICAL_JSON + '\n');
  for (const kind of ['datum','baseline']) {
    const input = await request(source, true);
    if (kind === 'datum') input.referenceArtifact = { ...reference, datumSpec: { path: datum, sha256: HANDLE_DATUM_SHA256 } };
    else input.inputArtifacts[0]!.path = reference.path;
    const result = await cadToolAdapter(input);
    assert.equal(result.status, 'failed'); assert.notEqual(result.error?.code, 'TOOL_UNAVAILABLE');
    assert.equal(result.artifacts.length, 0); assert.equal(result.checks.length, 0);
  }
});

test('handle timeout and active cancellation remove candidate containers', { timeout: 30000 }, async () => {
  const names = async () => (await exec('docker', ['ps','-a','--filter','name=wk-cad-','--format','{{.Names}}'])).stdout.trim();
  const beforeNames = await names();
  const source = "import subprocess,sys,time\nsubprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True)\ntime.sleep(120)\n";
  const timed = await cadToolAdapter({ ...await request(source, true), remainingBudgetMs: 1800 });
  assert.equal(timed.error?.code, 'RUN_TIMEOUT'); assert.deepEqual(await names(), beforeNames);
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 1800);
  try {
    const result = await cadToolAdapter({ ...await request(source, true), signal: abort.signal });
    assert.equal(result.error?.code, 'RUN_TIMEOUT'); assert.equal(result.artifacts.length, 0);
    assert.deepEqual(await names(), beforeNames);
  } finally { clearTimeout(timer); }
});

test('handle fixture retains strict shared shape, fixture provenance and bundle identity', async () => {
  const value = ToolResultSchema.parse(JSON.parse(await fs.readFile('fixtures/tools/handle-v2-result.fixture.json', 'utf8')));
  await verifyRequirements(value.requirements);
  assert.equal(value.executionMode, 'fixture'); assert.equal(value.engine?.name, 'fixture');
  assert.equal(value.registryId, 'handle_sample_v1'); assert.equal(value.checks.length, 9);
  assert.ok(value.checks.every(c => c.executionMode === 'fixture'));
  assert.ok(value.artifacts.every(a => a.executionMode === 'fixture'));
  assert.equal(await computeCheckBundleHash({ ...value, revisionId: value.outputRevisionId }), value.checkBundleHash);
});
