// OUTSIDE_WRAPPER acceptance bootstrap. Mutants change disposable copies only.
// A pass establishes test sensitivity for shared contracts, never live CAD or HTTP acceptance.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suite = 'tests/e2e/contracts-v2.acceptance.test.mjs';
const required = ['VALID_FIXTURE', 'MISSING_REQUIRED', 'EMPTY_CHECKS', 'DUPLICATE_CHECK', 'UNKNOWN_CHECK', 'FAILED_CHECK', 'NOT_EVALUATED', 'CHECK_BINDINGS', 'ARTIFACT_BINDINGS', 'STALE_BUNDLE', 'REQUIREMENTS_HASH', 'DISPATCH_BINDINGS', 'FIXTURE_PROVENANCE', 'ACCEPT_ACTION', 'EXPLICIT_REQUIREMENTS', 'CANONICAL_BYTES', 'DUPLICATE_JSON', 'MULTIBYTE_SOURCE', 'FEATURE_SETUP', 'EXPORT_DESCRIPTOR', 'TOOL_DEADLINE'];
const contracts = 'src/shared/contracts-v2.ts';
const requirements = 'src/shared/requirements-v2.ts';
const mutations = [
  { id: 'omit_required_set', test: 'MISSING_REQUIRED', edits: [[contracts, '(complete && !sameJson([...ids].sort(), [...requirements.requiredChecks].sort()))', 'false']] },
  { id: 'permit_duplicate_set', test: 'DUPLICATE_CHECK', edits: [[contracts, 'new Set(ids).size !== ids.length || ids.some(id => !requirements.requiredChecks.includes(id))', 'false || ids.some(id => !requirements.requiredChecks.includes(id))'], [contracts, '(complete && !sameJson([...ids].sort(), [...requirements.requiredChecks].sort()))', 'false']] },
  { id: 'permit_failed_reviewable', test: 'FAILED_CHECK', edits: [[contracts, "if (candidate.status === 'reviewable' && (", "if (false && ("]] },
  { id: 'ignore_check_bindings', test: 'CHECK_BINDINGS', edits: [[contracts, "if (!matchesRequirements(check, requirements) || check.revisionId !== revisionId || check.geometryHash !== geometryHash || check.executionMode !== executionMode)", 'if (false)']] },
  { id: 'ignore_artifact_bindings', test: 'ARTIFACT_BINDINGS', edits: [[contracts, 'for (const artifact of candidate.artifacts) {', 'for (const artifact of [] as Artifact[]) {']] },
  { id: 'ignore_bundle_hash', test: 'STALE_BUNDLE', edits: [[contracts, 'if (candidate.checkBundleHash !== null && await computeCheckBundleHash(candidate) !== candidate.checkBundleHash)', 'if (false)']] },
  { id: 'ignore_requirements_hash', test: 'REQUIREMENTS_HASH', edits: [[requirements, "if (await sha256(requirements.registryCanonicalJson) !== requirements.registryHash\n    || await sha256(requirements.setupCanonicalJson) !== requirements.setupHash)", 'if (false)']] },
  { id: 'ignore_dispatched_input', test: 'DISPATCH_BINDINGS', edits: [[contracts, "if (echoKeys.some(key => result[key] !== expected[key]) || !sameJson(result.requirements, expected.requirements)\n    || !sameJson(result.proposal, expected.proposal))", 'if (false)']] },
  { id: 'permit_fixture_engine_live', test: 'FIXTURE_PROVENANCE', edits: [[contracts, "if (candidate.executionMode === 'live' && candidate.engine?.name === 'fixture')", 'if (false)']] },
  { id: 'omit_explicit_accept_action', test: 'ACCEPT_ACTION', edits: [[contracts, 'geometryHash: HashSchema, checkBundleHash: HashSchema, userActionId: IdSchema,', 'geometryHash: HashSchema, checkBundleHash: HashSchema, userActionId: IdSchema.optional(),']] },
  { id: 'permit_duplicate_json_keys', test: 'DUPLICATE_JSON', edits: [['src/shared/canonical-json.ts', 'if (keys.has(key)) return fail();', 'if (false) return fail();']] },
  { id: 'count_source_characters_not_bytes', test: 'MULTIBYTE_SOURCE', edits: [[contracts, 'new TextEncoder().encode(value).length <= MAX_PYTHON_SOURCE_BYTES', 'value.length <= MAX_PYTHON_SOURCE_BYTES']] },
  { id: 'allow_feature_length_argument', test: 'FEATURE_SETUP', edits: [[requirements, "if (setupId === 'tactile_feature_v1' && lengthMm !== undefined)", 'if (false)']] },
];

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, `Mutation requires exactly one known guard: ${before}`);
  return text.replace(before, after);
}
function count(tap, field) {
  const matches = [...tap.matchAll(new RegExp(`^# ${field} (\\d+)$`, 'gm'))];
  assert.equal(matches.length, 1, `Missing/unexpected TAP ${field} summary`);
  return Number(matches[0][1]);
}
function completedRun(result) {
  assert.equal(result.error, undefined, 'Test subprocess failed or timed out');
  assert.equal(result.signal, null, 'Test subprocess was terminated');
  assert(count(result.stdout, 'tests') >= required.length, 'Required tests did not execute');
  for (const label of ['skipped', 'todo', 'cancelled']) assert.equal(count(result.stdout, label), 0, `${label} tests cannot establish coverage`);
}
function assertTargetFailure(tap, id) {
  assert(tap.split('\n').some(line => /^not ok \d+ - /.test(line) && line.includes(`[${id}]`)), `Mutation survived target assertion [${id}]`);
}
const control = `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const c = await import('./src/shared/contracts-v2.ts');
const fixture = async name => JSON.parse(await readFile('fixtures/api/v2/' + name, 'utf8'));
for (const name of ['reviewable.fixture.json','rejected.fixture.json']) {
  const b = c.BootstrapSchema.parse(await fixture(name));
  assert.equal(b.executionMode, 'fixture');
  assert.equal(b.design.acceptedRevisionId, null);
  await c.verifyCandidateEvidence(b.candidates[0]);
}
await c.verifyRequirements(await fixture('feature-requirements.fixture.json'));
await c.verifyToolResult(await fixture('tool-result.fixture.json'), await fixture('tool-input.fixture.json'));
c.EventSchema.parse(await fixture('event.fixture.json'));
c.AcceptanceRequestSchema.parse(await fixture('acceptance-request.fixture.json'));
assert.equal(c.parseStrictJson('{"x":1}').x,1);
console.log('Valid fixture controls pass; no CAD/provider/HTTP executed.');
`;
function run(cwd, args) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
}

const selfTest = process.argv.includes('--self-test');
if (selfTest) {
  assert.equal(replaceOnce('abc guard xyz', 'guard', 'changed'), 'abc changed xyz');
  assert.throws(() => replaceOnce('guard guard', 'guard', 'x'));
  assert.throws(() => replaceOnce('absent', 'guard', 'x'));
  assertTargetFailure('not ok 4 - [STALE_BUNDLE] mutation detected', 'STALE_BUNDLE');
  assert.throws(() => assertTargetFailure('not ok 1 - module import error', 'STALE_BUNDLE'));
  const zero = { error: undefined, signal: null, stdout: '# tests 0\n# skipped 0\n# todo 0\n# cancelled 0\n' };
  assert.throws(() => completedRun(zero));
  assert.throws(() => completedRun({ ...zero, stdout: '# tests 21\n# skipped 1\n# todo 0\n# cancelled 0\n' }));
}

const runtime = resolve(root, '.runtime/demo-test-quality');
await mkdir(runtime, { recursive: true });
const evidence = await mkdtemp(resolve(runtime, selfTest ? 'bootstrap-' : 'run-'));
const report = { mode: 'synthetic contract mutation testing', productAcceptance: 'NOT_ESTABLISHED', startedAt: new Date().toISOString(), evidence, requiredTests: required, mutations: [], sourceHash: null };
const copies = ['package.json', 'src/shared', 'fixtures/api', 'tests/e2e'];
for (const [index, mutation] of [null, ...mutations].entries()) {
  const label = mutation?.id ?? 'baseline';
  const cwd = resolve(evidence, String(index) + '-' + label);
  await mkdir(cwd);
  for (const path of copies) await cp(resolve(root, path), resolve(cwd, path), { recursive: true });
  await symlink(resolve(root, 'node_modules'), resolve(cwd, 'node_modules'), 'dir');
  for (const [path, before, after] of mutation?.edits ?? []) {
    const target = resolve(cwd, path);
    await writeFile(target, replaceOnce(await readFile(target, 'utf8'), before, after));
  }
  const healthy = run(cwd, ['--import', 'tsx', '--input-type=module', '-e', control]);
  await writeFile(resolve(cwd, 'control.log'), healthy.stdout + healthy.stderr);
  assert.equal(healthy.status, 0, `${label}: valid controls failed, so this is not a valid guard-removal test; ${healthy.stderr}`);
  if (selfTest) {
    report.mutations.push({ id: label, validControls: 'PASS', authoredSuite: 'NOT_RUN' });
    continue;
  }
  const result = run(cwd, ['--import', 'tsx', '--test', '--test-reporter=tap', suite]);
  await writeFile(resolve(cwd, 'suite.tap'), result.stdout + result.stderr);
  completedRun(result);
  if (!mutation) {
    assert.equal(result.status, 0, `Unmodified implementation fails new acceptance assertions: ${result.stdout}`);
    assert.equal(count(result.stdout, 'fail'), 0);
    for (const id of required) assert(result.stdout.split('\n').some(line => /^ok \d+ - /.test(line) && line.includes(`[${id}]`)), `Missing passing case [${id}]`);
    report.sourceHash = createHash('sha256').update(await readFile(resolve(root, suite))).digest('hex');
  } else {
    assert.notEqual(result.status, 0, `${label}: mutation survived`);
    assertTargetFailure(result.stdout, mutation.test);
  }
  report.mutations.push({ id: label, validControls: 'PASS', authoredSuite: mutation ? 'TARGET_MUTATION_DETECTED' : 'PASS', tests: count(result.stdout, 'tests'), failures: count(result.stdout, 'fail') });
}
report.finishedAt = new Date().toISOString();
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ mode: report.mode, bootstrapOnly: selfTest, validMutations: mutations.length, evidence, productAcceptance: report.productAcceptance }));
