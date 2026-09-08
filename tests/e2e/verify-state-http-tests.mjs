// OUTSIDE_WRAPPER acceptance setup. Alter disposable copies, never the application checkout.
// Real HTTP/state code with synthetic bytes proves software behavior, not CAD or physical results.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suite = 'tests/e2e/state-http.acceptance.test.mjs';
const required = ['HTTP_FLOW', 'NO_AUTO_ACCEPT', 'ACCEPT_SELECTION', 'ACCEPT_STATE_CAS', 'REQUIREMENTS_CAS', 'IDEMPOTENT_PAYLOAD', 'HISTORY_RELOAD', 'HISTORY_CLONE', 'EVENT_CURSOR', 'EXPORT_RETRY_RECHECK', 'DOWNLOAD_INTEGRITY', 'HTTP_BODY_LIMIT', 'HTTP_DUPLICATE_JSON', 'LATE_RESULT', 'RESTART_INTERRUPT', 'UNAVAILABLE_VISIBLE', 'FAILED_EVIDENCE', 'RESET_REPEAT'];
const store = 'src/server/store.ts';
const app = 'src/server/app.ts';
const mutations = [
  { id: 'completion_promotes', test: 'NO_AUTO_ACCEPT', edits: [[store, 'if (compatible) { d.selectedCandidateRevisionId = candidate.revisionId; d.activeRunId = null; }', 'if (compatible) { d.selectedCandidateRevisionId = candidate.revisionId; d.activeRunId = null; d.acceptedRevisionId = candidate.revisionId; }']] },
  { id: 'ignore_selected_candidate', test: 'ACCEPT_SELECTION', edits: [[store, '|| request.candidateRevisionId !== d.selectedCandidateRevisionId', '|| false']] },
  { id: 'ignore_accept_state_cas', test: 'ACCEPT_STATE_CAS', edits: [[store, 'request.designId !== d.designId || request.expectedStateVersion !== d.stateVersion', 'request.designId !== d.designId || false']] },
  { id: 'ignore_requirements_cas', test: 'REQUIREMENTS_CAS', edits: [[store, 'if (!d || request.expectedStateVersion !== d.stateVersion || request.expectedRequirementsVersion !== old.requirementsVersion) conflict();', 'if (!d) conflict();']] },
  { id: 'ignore_retry_payload', test: 'IDEMPOTENT_PAYLOAD', edits: [[store, "if (entry && (entry.operation !== operation || entry.payload !== canonicalize(payload))) conflict('IDENTITY_CONFLICT');", "if (false) conflict('IDENTITY_CONFLICT');"]] },
  { id: 'hide_acceptance_history', test: 'HISTORY_RELOAD', edits: [[app, 'contractVersion: CONTRACT_VERSION, acceptances: store.listAcceptances(), manifests: store.listManifests(),', 'contractVersion: CONTRACT_VERSION, acceptances: [], manifests: [],']] },
  { id: 'expose_history_references', test: 'HISTORY_CLONE', edits: [[store, 'listAcceptances() { return structuredClone([...this.snapshot.acceptances].reverse()); }', 'listAcceptances() { return [...this.snapshot.acceptances].reverse(); }'], [store, 'listManifests() { return structuredClone([...this.snapshot.manifests].reverse()); }', 'listManifests() { return [...this.snapshot.manifests].reverse(); }']] },
  { id: 'replay_cursor_event', test: 'EVENT_CURSOR', edits: [[store, 'e.eventId > afterEventId', 'e.eventId >= afterEventId']] },
  { id: 'reuse_export_without_recheck', test: 'EXPORT_RETRY_RECHECK', edits: [[store, "const retry = this.retry(s, 'export', request, payload);", "const retry = this.retry(s, 'export', request, payload);\n      if (retry) return { acceptance: s.acceptances.find(a => a.acceptanceId === request.acceptanceId)!, manifest: s.manifests.find(m => m.manifestId === request.manifestId)!, reused: true };"]] },
  { id: 'ignore_registered_bytes_hash', test: 'DOWNLOAD_INTEGRITY', edits: [['src/server/artifacts.ts', "if (content.length !== artifact.bytes || createHash('sha256').update(content).digest('hex') !== artifact.sha256) throw new Error('Stored artifact integrity failure');", "if (false) throw new Error('Stored artifact integrity failure');"]] },
  { id: 'double_http_body_limit', test: 'HTTP_BODY_LIMIT', edits: [[app, 'if (size > 8192)', 'if (size > 16384)']] },
  { id: 'permit_duplicate_http_keys', test: 'HTTP_DUPLICATE_JSON', edits: [[app, "return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))", "return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))"]] },
  { id: 'make_late_result_current', test: 'LATE_RESULT', edits: [[store, "const compatible = pending(run) && d.activeRunId === run.runId && d.activeRequirementsVersion === run.requirementsVersion\n        && run.inputRevisionId === (d.acceptedRevisionId ?? d.baselineRevisionId) && candidate.setupHash === d.setupHash;", 'const compatible = true;']] },
  { id: 'leave_interrupted_run_pending', test: 'RESTART_INTERRUPT', edits: [[store, 'for (const run of next.runs.filter(pending))', 'for (const run of [] as Run[])']] },
];

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, `Expected one mutation anchor: ${before}`);
  return text.replace(before, after);
}
function count(tap, field) {
  const matches = [...tap.matchAll(new RegExp(`^# ${field} (\\d+)$`, 'gm'))];
  assert.equal(matches.length, 1, `Missing or ambiguous TAP ${field}`);
  return Number(matches[0][1]);
}
function completed(result) {
  assert.equal(result.error, undefined, 'Subprocess error or timeout');
  assert.equal(result.signal, null, 'Subprocess terminated');
  assert(count(result.stdout, 'tests') >= required.length, 'Required cases did not execute');
  for (const label of ['skipped', 'todo', 'cancelled']) assert.equal(count(result.stdout, label), 0, `${label} is not coverage`);
}
function targetedFailure(tap, name) {
  assert(tap.split('\n').some(line => /^not ok \d+ - /.test(line) && line.includes(`[${name}]`)), `Mutation survived target [${name}]`);
}
function run(cwd, args) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 6 * 1024 * 1024 });
}
const control = `
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { RunStore } from './src/server/store.ts';
import { createApp } from './src/server/app.ts';
import { createRequirements, CONTRACT_VERSION, BootstrapSchema } from './src/shared/contracts.ts';
const fixture = JSON.parse(await readFile('fixtures/api/v2/reviewable.fixture.json', 'utf8'));
const requirements = await createRequirements({ designId: 'demo_control', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
const design = { ...fixture.design, designId: requirements.designId, setupHash: requirements.setupHash, stateVersion: 0, activeRequirementsVersion: 1, acceptedRevisionId: null, acceptedRequirementsMatch: false, selectedCandidateRevisionId: null, activeRunId: null };
const runtime = await mkdtemp(path.join(tmpdir(), 'wk-demo-control-'));
const store = new RunStore(runtime, design, requirements);
const server = createApp(store, runtime);
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const health = await fetch(base + '/api/health'); assert.equal(health.status, 200);
  assert.equal((await health.json()).executionMode, 'unavailable');
  const bootstrap = await fetch(base + '/api/bootstrap'); assert.equal(bootstrap.status, 200);
  assert.equal(BootstrapSchema.parse(await bootstrap.json()).design.acceptedRevisionId, null);
  const history = await fetch(base + '/api/acceptances'); assert.equal(history.status, 200);
  assert.deepEqual(await history.json(), { contractVersion: CONTRACT_VERSION, acceptances: [], manifests: [] });
  const request = { contractVersion: CONTRACT_VERSION, requestId: 'control_confirm', expectedStateVersion: 0, expectedRequirementsVersion: 1, setupId: 'resize_centered_v1', confirmedIntent: { lengthMm: 40 }, userActionId: 'control_action' };
  const update = await fetch(base + '/api/designs/demo_control/requirements', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(update.status, 200); assert.equal((await update.json()).requirements.setup.dimensions.lengthMm, 40);
  console.log('Healthy HTTP and state controls pass. Adapters unavailable; no CAD/provider.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(runtime, { recursive: true, force: true }); }
`;

const selfTest = process.argv.includes('--self-test');
if (selfTest) {
  assert.equal(replaceOnce('one guard', 'guard', 'change'), 'one change');
  assert.throws(() => replaceOnce('guard guard', 'guard', 'x'));
  assert.throws(() => replaceOnce('absent', 'guard', 'x'));
  targetedFailure('not ok 4 - [EVENT_CURSOR] duplicated event', 'EVENT_CURSOR');
  assert.throws(() => targetedFailure('not ok 1 - module import error', 'EVENT_CURSOR'));
  const zero = { error: undefined, signal: null, stdout: '# tests 0\n# skipped 0\n# todo 0\n# cancelled 0\n' };
  assert.throws(() => completed(zero));
  assert.throws(() => completed({ ...zero, stdout: '# tests 18\n# skipped 1\n# todo 0\n# cancelled 0\n' }));
}
const evidenceRoot = resolve(root, '.runtime/demo-state-http-quality');
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(resolve(evidenceRoot, selfTest ? 'bootstrap-' : 'run-'));
const report = { mode: 'Real state and HTTP, synthetic artifacts; mutation sensitivity', fullProductAcceptance: 'NOT_ESTABLISHED', startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, evidence, requiredTests: required, mutations: [], suiteSha256: null };
for (const [index, mutation] of [null, ...mutations].entries()) {
  const label = mutation?.id ?? 'baseline';
  const cwd = resolve(evidence, String(index) + '-' + label);
  await mkdir(cwd);
  for (const item of ['package.json', 'src/server', 'src/shared', 'fixtures/api', 'tests/e2e']) await cp(resolve(root, item), resolve(cwd, item), { recursive: true });
  await symlink(resolve(root, 'node_modules'), resolve(cwd, 'node_modules'), 'dir');
  for (const [file, before, after] of mutation?.edits ?? []) {
    const target = resolve(cwd, file);
    await writeFile(target, replaceOnce(await readFile(target, 'utf8'), before, after));
  }
  const healthy = run(cwd, ['--import', 'tsx', '--input-type=module', '-e', control]);
  await writeFile(resolve(cwd, 'control.log'), healthy.stdout + healthy.stderr);
  assert.equal(healthy.status, 0, `${label}: healthy controls failed: ${healthy.stderr}`);
  if (selfTest) { report.mutations.push({ id: label, healthyControl: 'PASS', authoredSuite: 'NOT_RUN' }); continue; }
  const result = run(cwd, ['--import', 'tsx', '--test', '--test-reporter=tap', suite]);
  await writeFile(resolve(cwd, 'suite.tap'), result.stdout + result.stderr);
  completed(result);
  if (!mutation) {
    assert.equal(result.status, 0, `Baseline acceptance failure: ${result.stdout}`);
    assert.equal(count(result.stdout, 'fail'), 0);
    for (const name of required) assert(result.stdout.split('\n').some(line => /^ok \d+ - /.test(line) && line.includes(`[${name}]`)), `Missing passing [${name}]`);
    report.suiteSha256 = createHash('sha256').update(await readFile(resolve(root, suite))).digest('hex');
  } else { assert.notEqual(result.status, 0, `${label}: mutation survived`); targetedFailure(result.stdout, mutation.test); }
  report.mutations.push({ id: label, healthyControl: 'PASS', authoredSuite: mutation ? 'TARGET_MUTATION_DETECTED' : 'PASS', tests: count(result.stdout, 'tests'), failures: count(result.stdout, 'fail') });
}
report.finishedAt = new Date().toISOString();
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ bootstrapOnly: selfTest, mutationCount: mutations.length, evidence, fullProductAcceptance: report.fullProductAcceptance }));
