import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only milestone probe. A reachable transport cannot prove geometry or UI acceptance.
const product = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseUrl = new URL(process.argv[2] ?? 'http://127.0.0.1:4310');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname), 'Use an agreed local test instance');
assert(!baseUrl.username && !baseUrl.password, 'Do not place credentials in the target URL');
assert(process.argv[3], 'Usage: node tests/e2e/acceptance-probe.mjs URL NEW_EVIDENCE_DIRECTORY');
const evidence = resolve(process.argv[3]);
await mkdir(evidence, { recursive: false });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function snapshot() {
  const files = {};
  async function walk(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files[relative(product, child)] = sha(await readFile(child));
    }
  }
  await walk(resolve(product, 'src'));
  await walk(resolve(product, 'tests/e2e'));
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) {
    try { files[name] = sha(await readFile(resolve(product, name))); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { id: sha(JSON.stringify(files)), files };
}
function git(args) {
  try { return execFileSync('git', ['-C', product, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}
const report = {
  startedAt: new Date().toISOString(), baseUrl: baseUrl.origin, product,
  branch: git(['branch', '--show-current']), commit: git(['rev-parse', '--verify', 'HEAD']),
  gitStatus: git(['status', '--short', '--branch']),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  mode: 'live HTTP requests; no fixture substitution; GET only',
  sourceBefore: await snapshot(), results: [],
  limits: ['No geometry, model execution, browser rendering, downloads, failure injection or reset acceptance is established by this probe.'],
};
async function get(path) {
  try {
    const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const body = await response.text();
    const name = path.replace(/[^a-zA-Z0-9]/g, '_') || 'root';
    await writeFile(resolve(evidence, name + '.txt'), body);
    let json;
    try { json = JSON.parse(body); } catch { json = null; }
    return { path, status: response.status, contentType: response.headers.get('content-type'), bytes: Buffer.byteLength(body), sha256: sha(body), bodyFile: name + '.txt', json };
  } catch (error) {
    return { path, networkError: String(error.cause?.code ?? error.message) };
  }
}
function check(id, response, assertion) {
  if (response.networkError) {
    report.results.push({ id, state: 'BLOCKED', reason: response.networkError, response });
    return;
  }
  try { assertion(); report.results.push({ id, state: 'PASS', response }); }
  catch (error) { report.results.push({ id, state: 'FAIL', reason: error.message, response }); }
}
const health = await get('/api/health');
check('HTTP-HEALTH', health, () => {
  assert.equal(health.status, 200);
  assert.match(health.contentType ?? '', /application\/json/);
  assert(health.json && typeof health.json === 'object');
});
const bootstrap = await get('/api/bootstrap');
check('HTTP-BOOTSTRAP', bootstrap, () => {
  assert.equal(bootstrap.status, 200);
  const data = bootstrap.json;
  assert(data);
  assert.equal(data.contractVersion, 'wk-backend-draft-0.1', 'Reconcile this probe with PLAN before accepting a new contract');
  assert(['not_selected', 'selected'].includes(data.scopeStatus));
  assert(['live', 'fixture', 'unavailable'].includes(data.executionMode));
  assert(Array.isArray(data.runs));
  if (data.scopeStatus === 'not_selected') {
    assert.equal(data.design, null);
    assert.equal(data.executionMode, 'unavailable');
    assert.equal(data.runs.length, 0);
    assert.equal(typeof data.unavailableReason, 'string');
    assert(data.unavailableReason.length > 0);
  }
  for (const run of data.runs) {
    assert.equal(run.contractVersion, data.contractVersion);
    assert.equal(run.units, 'mm');
    assert(run.runId && run.designId && run.inputRevisionId && run.outputRevisionId);
    if (run.evidenceApplicability === 'current') {
      assert.equal(run.outputRevisionId, data.design?.currentRevisionId);
      assert.equal(run.executionMode, 'live');
    }
    if (run.status === 'failed') assert(run.error?.code && run.error?.message);
    for (const item of [...run.checks, ...run.artifacts]) assert.equal(item.revisionId, run.outputRevisionId);
    for (const artifact of run.artifacts) {
      assert.equal(artifact.runId, run.runId);
      assert.equal(artifact.designId, run.designId);
      assert.equal(artifact.executionMode, run.executionMode);
    }
  }
});
for (const path of ['/api/runs/demo-nonexistent-run', '/api/artifacts/demo-nonexistent-artifact']) {
  const response = await get(path);
  check('HTTP-NOT-FOUND:' + path, response, () => {
    assert.equal(response.status, 404);
    assert.equal(typeof response.json?.error?.code, 'string');
    assert.equal(typeof response.json?.error?.message, 'string');
  });
}
const root = await get('/');
check('HTTP-PAGE', root, () => {
  assert.equal(root.status, 200);
  assert.match(root.contentType ?? '', /text\/html/);
});
report.sourceAfter = await snapshot();
report.sourceChangedDuringTest = report.sourceBefore.id !== report.sourceAfter.id;
report.finishedAt = new Date().toISOString();
report.counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(state => [state, report.results.filter(result => result.state === state).length]));
report.productAcceptance = 'NOT_ESTABLISHED';
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ evidence, ...report.counts, sourceChangedDuringTest: report.sourceChangedDuringTest, productAcceptance: report.productAcceptance }));
process.exitCode = report.counts.FAIL ? 1 : report.counts.BLOCKED || report.sourceChangedDuringTest ? 2 : 0;
