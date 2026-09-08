import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Exercise real validation only while the isolated server cannot accept a design edit.
const base = new URL(process.argv[2]);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
assert(!base.username && !base.password && base.port !== '4310', 'Use a distinct DEMO instance');
assert(process.argv[3] && process.argv[4], 'Usage: node unselected-acceptance.mjs URL NEW_EVIDENCE_DIR SOURCE_PROBE_REPORT');
const evidence = resolve(process.argv[3]);
await mkdir(evidence, { recursive: false });
const sourceReport = JSON.parse(await readFile(resolve(process.argv[4]), 'utf8'));
assert.equal(sourceReport.baseUrl, base.origin);
const report = { startedAt: new Date().toISOString(), baseUrl: base.origin,
  sourceProbe: resolve(process.argv[4]), sourceSnapshot: sourceReport.sourceBefore.id,
  execution: 'Live HTTP against isolated unselected backend. Fixture disclosure/download tested separately; no live CAD or model execution.', results: [] };
async function request(path, options) {
  const response = await fetch(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json = null;
  try { json = JSON.parse(bytes.toString('utf8')); } catch {}
  return { status: response.status, headers: Object.fromEntries(response.headers), json,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), body: bytes.toString('utf8') };
}
async function test(id, perform) {
  const item = { id, state: 'PASS' };
  try { await perform(item); } catch (error) { item.state = 'FAIL'; item.reason = error.message; }
  report.results.push(item);
}
const before = await request('/api/bootstrap');
assert.equal(before.status, 200);
assert.equal(before.json.scopeStatus, 'not_selected', 'This suite must never send requests to a selected design');
assert.equal(before.json.design, null);
assert.equal(before.json.runs.length, 0);
const valid = { contractVersion: 'wk-backend-draft-0.1', requestId: 'demo_validation_1', designId: 'unselected', inputRevisionId: 'unselected_rev_0', units: 'mm', instruction: 'Increase width by 5 mm while preserving the mounting interface.' };
const cases = [
  ['malformed-json', '{', 'application/json', 400, 'INVALID_JSON'],
  ['missing-content-type', JSON.stringify(valid), 'text/plain', 415, 'CONTENT_TYPE'],
  ['empty-object', '{}', 'application/json', 400, 'INVALID_REQUEST'],
  ['wrong-version', JSON.stringify({ ...valid, contractVersion: 'outdated' }), 'application/json', 400, 'INVALID_REQUEST'],
  ['wrong-units', JSON.stringify({ ...valid, units: 'in' }), 'application/json', 400, 'INVALID_REQUEST'],
  ['empty-instruction', JSON.stringify({ ...valid, instruction: '  ' }), 'application/json', 400, 'INVALID_REQUEST'],
  ['extra-field', JSON.stringify({ ...valid, forceSuccess: true }), 'application/json', 400, 'INVALID_REQUEST'],
  ['unselected-live-request', JSON.stringify(valid), 'application/json', 503, 'SCOPE_NOT_SELECTED'],
];
for (const [id, body, contentType, status, code] of cases) {
  await test(id, async item => {
    item.request = { method: 'POST', path: '/api/runs', contentType, body };
    item.response = await request('/api/runs', { method: 'POST', headers: { 'Content-Type': contentType }, body });
    assert.equal(item.response.status, status);
    assert.equal(item.response.json?.error?.code, code);
    assert.equal(item.response.json?.contractVersion, valid.contractVersion);
    assert(item.response.json?.error?.message);
    assert.equal(typeof item.response.json?.error?.retryable, 'boolean');
    assert.equal(item.response.json?.run, undefined);
  });
}
let fixture;
await test('fixture-disclosure', async item => {
  item.response = await request('/api/fixtures/run');
  assert.equal(item.response.status, 200);
  fixture = item.response.json;
  assert.equal(fixture.executionMode, 'fixture');
  assert.equal(fixture.evidenceApplicability, 'fixture');
  assert.equal(fixture.provider, null);
  assert(fixture.checks.length > 0);
  assert(fixture.checks.every(check => check.state === 'not_evaluated' && check.revisionId === fixture.outputRevisionId));
});
await test('fixture-download-integrity', async item => {
  assert(fixture, 'Fixture endpoint prerequisite failed');
  const artifact = fixture.artifacts[0];
  assert(artifact?.href?.startsWith('/api/artifacts/'));
  item.artifact = artifact;
  item.response = await request(artifact.href);
  assert.equal(item.response.status, 200);
  assert.equal(item.response.bytes, artifact.bytes);
  assert.equal(item.response.sha256, artifact.sha256);
  assert.equal(item.response.headers['x-worldkinetics-revision'], artifact.revisionId);
  assert.equal(item.response.headers['x-worldkinetics-execution'], 'fixture');
  assert(item.response.headers['content-disposition'].includes(artifact.fileName));
  assert.equal(item.response.json.executionMode, 'fixture');
  assert.match(item.response.json.notice, /not edited CAD/);
  await writeFile(resolve(evidence, 'downloaded-fixture-design.json'), item.response.body);
});
await test('no-accepted-edit-or-fixture-promotion', async item => {
  item.response = await request('/api/bootstrap');
  assert.deepEqual(item.response.json, before.json);
});
report.finishedAt = new Date().toISOString();
report.counts = { PASS: report.results.filter(item => item.state === 'PASS').length, FAIL: report.results.filter(item => item.state === 'FAIL').length };
report.productAcceptance = 'NOT_ESTABLISHED';
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ evidence, ...report.counts, productAcceptance: report.productAcceptance }));
process.exitCode = report.counts.FAIL ? 1 : 0;
