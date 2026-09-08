import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const modulePath = '../../src/shared/contracts-v2.js';
const load = () => import(modulePath);
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../../fixtures/api/v2/${name}`, import.meta.url), 'utf8'));
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

test('approved registry bytes and exact required check identities remain frozen', async () => {
  const raw = await readFile(new URL('../../fixtures/api/requirement-registry.json', import.meta.url));
  assert.equal(sha(raw), 'd9de0bbe0c6a03f101d5f9562360ac10d0a4216401533eb9be0b4148c8a9aa33');
  const registry = JSON.parse(raw.toString());
  assert.equal(registry.setups.resize_centered_v1.requiredChecks.length, 7);
  assert.equal(registry.setups.tactile_feature_v1.requiredChecks.length, 9);
});

test('canonical encoding is stable for numeric keys, Unicode, finite numbers and check order', async () => {
  const { canonicalize, parseStrictJson } = await load();
  const value = { z: -0, '2': 2, '10': 10, a: 'é\n', tiny: 1e-7, large: 1e21 };
  const expected = '{"10":10,"2":2,"a":"é\\n","large":1e+21,"tiny":1e-7,"z":0}';
  assert.equal(canonicalize(value), expected);
  assert.equal(sha(canonicalize(value)), sha(expected));
  assert.equal(canonicalize({ checks: [{ checkId: 'z', value: 1 }, { checkId: 'a', value: 2 }], requiredChecks: ['z', 'a'] }), '{"checks":[{"checkId":"a","value":2},{"checkId":"z","value":1}],"requiredChecks":["a","z"]}');
  assert.equal(canonicalize({ points: [[35, 17.5], [15, 17.5]] }), '{"points":[[35,17.5],[15,17.5]]}');
  for (const input of [NaN, Infinity, -Infinity, { x: undefined }, { checks: [{ checkId: 'a' }, { checkId: 'a' }] }, { requiredChecks: ['a', 'a'] }]) assert.throws(() => canonicalize(input));
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"z":1,"z":2}}', '{"x":1e400}', '{"x":NaN}']) assert.throws(() => parseStrictJson(input), input);
  assert.deepEqual(parseStrictJson('{"a":[1,2],"x":"é"}'), { a: [1, 2], x: 'é' });
});

test('v0.2 schemas and labeled bootstrap fixtures expose immutable evidence and no invented acceptance', async () => {
  const contracts = await load();
  assert.equal(contracts.CONTRACT_VERSION, 'wk-prototype-0.2');
  for (const name of ['BootstrapSchema', 'DesignSchema', 'RequirementsSchema', 'RunRequestSchema', 'RunSchema', 'CandidateSchema', 'CheckSchema', 'ArtifactSchema', 'EventSchema', 'AcceptanceRequestSchema', 'RequirementsUpdateRequestSchema', 'ExportRequestSchema', 'ToolInputSchema', 'ToolResultSchema', 'ProviderProposalSchema']) assert.equal(typeof contracts[name]?.parse, 'function', name);
  for (const name of ['reviewable.fixture.json', 'rejected.fixture.json']) {
    const raw = await fixture(name);
    const data = contracts.BootstrapSchema.parse(raw);
    assert.equal(data.executionMode, 'fixture');
    assert.match(JSON.stringify(data), /fixture/i);
    assert.equal(data.design.acceptedRevisionId, null);
    assert.ok(Number.isSafeInteger(data.design.stateVersion));
    assert.equal(data.requirements.requirementsVersion, data.design.activeRequirementsVersion);
    for (const key of ['registryHash', 'setupHash', 'referenceHash']) assert.match(data.requirements[key], /^[a-f0-9]{64}$/);
    assert.ok(data.requirements.requiredChecks.length >= 7);
    assert.ok(data.candidates.length > 0);
    const candidate = data.candidates[0];
    assert.equal(candidate.status, name.startsWith('reviewable') ? 'reviewable' : 'rejected');
    assert.equal(candidate.requirementsVersion, data.requirements.requirementsVersion);
    assert.equal(candidate.executionMode, 'fixture');
    assert.match(candidate.geometryHash, /^[a-f0-9]{64}$/);
    assert.match(candidate.checkBundleHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(candidate.checks.map((c: any) => c.checkId).sort(), [...data.requirements.requiredChecks].sort());
    for (const check of candidate.checks) {
      for (const key of ['geometryHash', 'referenceHash', 'setupHash', 'registryHash', 'validatorVersion', 'requirementsVersion']) assert.ok(check[key] !== undefined, key);
      assert.equal(check.executionMode, 'fixture');
      assert.equal(check.revisionId, candidate.revisionId);
      const missing = { ...check }; delete missing.geometryHash;
      assert.equal(contracts.CheckSchema.safeParse(missing).success, false);
      assert.equal(contracts.CheckSchema.safeParse({ ...check, injected: true }).success, false);
    }
    if (name.startsWith('rejected')) assert.equal(candidate.checks.find((c: any) => c.checkId === 'margin.end_material').state, 'failed');
  }
});

test('run, acceptance and source contracts reject ambiguous or incomplete authority', async () => {
  const c = await load();
  const request = { contractVersion: c.CONTRACT_VERSION, requestId: 'request_1', designId: 'plate', inputRevisionId: 'baseline_50', requirementsVersion: 1, setupId: 'resize_centered_v1', units: 'mm', instruction: 'Make length 30 mm' };
  assert.equal(c.RunRequestSchema.safeParse(request).success, true);
  for (const patch of [{ contractVersion: 'wk-backend-draft-0.1' }, { requirementsVersion: undefined }, { units: 'inches' }, { outputDir: '/tmp/untrusted' }]) assert.equal(c.RunRequestSchema.safeParse({ ...request, ...patch }).success, false);
  const data = await fixture('reviewable.fixture.json');
  const candidate = data.candidates[0];
  const acceptance = { contractVersion: c.CONTRACT_VERSION, requestId: 'accept_1', designId: data.design.designId, candidateRevisionId: candidate.revisionId, requirementsVersion: data.requirements.requirementsVersion, expectedStateVersion: data.design.stateVersion, expectedAcceptedRevisionId: null, registryHash: data.requirements.registryHash, setupHash: data.requirements.setupHash, geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash, userActionId: 'explicit_action_1' };
  assert.equal(c.AcceptanceRequestSchema.safeParse(acceptance).success, true);
  for (const key of ['expectedStateVersion', 'expectedAcceptedRevisionId', 'requirementsVersion', 'checkBundleHash', 'userActionId']) { const missing = { ...acceptance } as any; delete missing[key]; assert.equal(c.AcceptanceRequestSchema.safeParse(missing).success, false, key); }
  assert.equal(c.ProviderProposalSchema.safeParse({ kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: 36 } } }).success, true);
  const source = { kind: 'python_source', source: 'from build123d import Box\npart = Box(50,35,5)', changeSummary: 'Add a tactile feature' };
  assert.equal(c.ProviderProposalSchema.safeParse(source).success, true);
  for (const patch of [{ source: '' }, { source: 'x'.repeat(65537) }, { outputDir: '/tmp' }, { requirements: { minimumEndMaterialMm: 0 } }, { operation: { name: 'other', parameters: {} } }]) assert.equal(c.ProviderProposalSchema.safeParse({ ...source, ...patch }).success, false);
});
