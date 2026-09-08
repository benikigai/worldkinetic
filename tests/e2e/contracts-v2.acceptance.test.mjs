// Shared-contract conformance only. Synthetic evidence never establishes live acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as c from '../../src/shared/contracts-v2.ts';

const fixture = async name => JSON.parse(await readFile(new URL(`../../fixtures/api/v2/${name}.fixture.json`, import.meta.url), 'utf8'));
const reviewable = await fixture('reviewable');
const rejected = await fixture('rejected');
const toolInput = await fixture('tool-input');
const toolResult = await fixture('tool-result');
const featureRequirements = await fixture('feature-requirements');
const clone = value => structuredClone(value);
const candidate = () => clone(reviewable.candidates[0]);
const sha = value => createHash('sha256').update(value).digest('hex');
const wrongHash = sha('independent contract acceptance mismatch');
const resizeChecks = [
  'export.editable_reopen', 'export.step_reopen', 'export.stl_reopen',
  'geometry.requested_dimensions', 'geometry.valid_single_solid', 'holes.layout', 'margin.end_material',
];
const featureChecks = [...resizeChecks, 'feature.requested_change', 'interface.protected_region'].sort();
function invalid(schema, value, label) {
  assert.equal(schema.safeParse(value).success, false, label);
}
function without(value, key) {
  const copy = clone(value);
  delete copy[key];
  return copy;
}
function invalidCandidate(edit, label) {
  const value = candidate();
  edit(value);
  invalid(c.CandidateSchema, value, label);
}

// Keep these controls in the authored suite as well as the independent runner.
test('[VALID_FIXTURE] released synthetic records parse and verify without accepting a revision', async () => {
  for (const [record, status, length, margin] of [[reviewable, 'reviewable', 36, 5], [rejected, 'rejected', 30, 2]]) {
    const parsed = c.BootstrapSchema.parse(clone(record));
    assert.equal(parsed.executionMode, 'fixture');
    assert.equal(parsed.design.acceptedRevisionId, null);
    assert.equal(parsed.design.acceptedRequirementsMatch, false);
    assert.equal(parsed.candidates[0].status, status);
    assert.equal(parsed.runs[0].status, 'completed');
    assert.equal(parsed.requirements.setup.dimensions.lengthMm, length);
    assert.deepEqual([...parsed.requirements.requiredChecks].sort(), resizeChecks);
    assert.deepEqual(parsed.candidates[0].checks.map(check => check.checkId).sort(), resizeChecks);
    const evidence = await c.verifyCandidateEvidence(parsed.candidates[0]);
    assert.equal(evidence.executionMode, 'fixture');
    assert.equal(evidence.checks.find(check => check.checkId === 'margin.end_material').measured.minimumEndMaterialMm, margin);
    assert.equal(c.expectedForCheck(parsed.requirements, 'margin.end_material').minimumEndMaterialMm, 5);
  }
  await c.verifyRequirements(featureRequirements);
  assert.deepEqual([...featureRequirements.requiredChecks].sort(), featureChecks);
  await c.verifyToolInput(toolInput);
  assert.equal((await c.verifyToolResult(toolResult, toolInput)).status, 'completed');
  for (const [name, schema] of [
    ['event', c.EventSchema], ['run-request', c.RunRequestSchema],
    ['acceptance-request', c.AcceptanceRequestSchema], ['export-request', c.ExportRequestSchema],
    ['requirements-update-request', c.RequirementsUpdateRequestSchema],
    ['provider-proposal', c.ProviderProposalSchema], ['provider-python-proposal', c.ProviderProposalSchema],
  ]) assert.deepEqual(schema.parse(await fixture(name)), await fixture(name));
});

test('[MISSING_REQUIRED] every required check must occur in a completed candidate', () => {
  for (const checkId of resizeChecks) {
    invalidCandidate(value => { value.checks = value.checks.filter(check => check.checkId !== checkId); }, checkId);
  }
});

test('[EMPTY_CHECKS] an empty check array cannot be reviewable or rejected', () => {
  for (const status of ['reviewable', 'rejected']) {
    invalidCandidate(value => { value.status = status; value.checks = []; }, status);
  }
});

test('[DUPLICATE_CHECK] repeated required IDs fail with both full and replaced sets', () => {
  for (let index = 0; index < resizeChecks.length; index++) {
    invalidCandidate(value => { value.checks.push(clone(value.checks[index])); }, `extra ${index}`);
    invalidCandidate(value => { value.checks[(index + 1) % value.checks.length] = clone(value.checks[index]); }, `replacement ${index}`);
  }
});

test('[UNKNOWN_CHECK] unknown and registered-but-out-of-setup IDs are rejected', () => {
  invalidCandidate(value => { value.checks[0].checkId = 'geometry.unregistered'; }, 'unknown registry ID');
  const value = candidate();
  const check = value.checks[0];
  check.checkId = 'feature.requested_change';
  Object.assign(check, c.checkDefinition(check.checkId));
  check.expected = c.expectedForCheck(featureRequirements, check.checkId);
  c.CheckSchema.parse(check);
  invalid(c.CandidateSchema, value, 'registered check from the other setup');
});

test('[FAILED_CHECK] any failed required check blocks structural reviewability', () => {
  for (let index = 0; index < resizeChecks.length; index++) {
    const value = candidate();
    value.checks[index].state = 'failed';
    c.CheckSchema.parse(value.checks[index]);
    invalid(c.CandidateSchema, value, resizeChecks[index]);
    value.status = 'rejected';
    c.CandidateSchema.parse(value);
  }
});

test('[NOT_EVALUATED] unevaluated required checks block review even with other passes', () => {
  for (let index = 0; index < resizeChecks.length; index++) {
    const value = candidate();
    value.checks[index].state = 'not_evaluated';
    value.checks[index].measured = null;
    c.CheckSchema.parse(value.checks[index]);
    invalid(c.CandidateSchema, value, resizeChecks[index]);
    value.status = 'rejected';
    c.CandidateSchema.parse(value);
  }
});

const requirementMismatches = {
  requirementsVersion: 99, requirementsId: 'different_requirements', registryHash: wrongHash,
  setupId: 'tactile_feature_v1', setupHash: wrongHash, referenceHash: wrongHash, validatorVersion: 'different_validator',
};
test('[CHECK_BINDINGS] each check binds every requirement identity, revision, geometry and mode', () => {
  for (let index = 0; index < resizeChecks.length; index++) {
    for (const [key, replacement] of Object.entries({ ...requirementMismatches, revisionId: 'different_revision', geometryHash: wrongHash, executionMode: 'live' })) {
      const value = candidate();
      value.checks[index][key] = replacement;
      c.CheckSchema.parse(value.checks[index]);
      invalid(c.CandidateSchema, value, `${resizeChecks[index]} ${key}`);
    }
    invalidCandidate(value => { value.checks[index].registryId = 'different_registry'; }, 'registry identity is a frozen literal');
  }
  for (const edit of [
    check => { check.method = 'Trust candidate assertions'; },
    check => { check.units = ['mm']; },
    check => { check.expected.relativeVolume = 1; },
  ]) invalidCandidate(value => edit(value.checks[0]), 'frozen method, units and expectations');
});

test('[ARTIFACT_BINDINGS] every public artifact binds its candidate and requirements', () => {
  for (let index = 0; index < reviewable.candidates[0].artifacts.length; index++) {
    for (const [key, replacement] of Object.entries({ ...requirementMismatches, runId: 'different_run', designId: 'different_design', revisionId: 'different_revision', executionMode: 'live' })) {
      const value = candidate();
      value.artifacts[index][key] = replacement;
      c.ArtifactSchema.parse(value.artifacts[index]);
      invalid(c.CandidateSchema, value, `artifact ${index} ${key}`);
    }
    invalidCandidate(value => { value.artifacts[index].registryId = 'different_registry'; }, 'frozen registry identity');
  }
  for (const kind of ['source', 'editable']) {
    invalidCandidate(value => { value.artifacts = value.artifacts.filter(artifact => artifact.kind !== kind); }, `missing ${kind}`);
  }
  for (const mediaType of ['model/step', 'model/stl']) {
    invalidCandidate(value => { value.artifacts = value.artifacts.filter(artifact => artifact.mediaType !== mediaType); }, `missing ${mediaType}`);
  }
  invalidCandidate(value => { value.artifacts.find(artifact => artifact.mediaType === 'model/step').sha256 = wrongHash; }, 'sealed STEP identity');
  invalidCandidate(value => { value.artifacts.find(artifact => artifact.kind === 'source').sha256 = wrongHash; }, 'sealed source identity');
  invalidCandidate(value => { value.artifacts.push(clone(value.artifacts[0])); }, 'duplicate artifact ID');
});

test('[STALE_BUNDLE] structural validity does not authenticate changed bundle bytes', async () => {
  for (const edit of [
    value => { value.checks[0].details = 'Changed synthetic evidence detail'; },
    value => { value.checks[0].measured.volumeMm3 += 1; },
    value => { value.engine.version = 'different_engine_version'; },
    value => { value.engine.imageDigest = `sha256:${wrongHash}`; },
    value => { value.proposalHash = wrongHash; },
    value => { value.checkBundleHash = wrongHash; },
  ]) {
    const value = candidate();
    edit(value);
    c.CandidateSchema.parse(value);
    await assert.rejects(c.verifyCandidateEvidence(value), /Check bundle hash mismatch/);
  }
  for (const name of ['reviewable', 'rejected']) {
    const bundle = await fixture(`${name}.check-bundle`);
    const value = (await fixture(name)).candidates[0];
    assert.deepEqual(c.checkBundleHashPayload(value), bundle.payload);
    assert.equal(c.canonicalize(bundle.payload), bundle.canonicalJson);
    assert.equal(sha(Buffer.from(bundle.canonicalJson, 'utf8')), bundle.sha256);
    assert.equal(await c.computeCheckBundleHash(value), bundle.sha256);
    value.checks.reverse();
    assert.equal((await c.verifyCandidateEvidence(value)).checkBundleHash, bundle.sha256);
  }
});

test('[REQUIREMENTS_HASH] a well-formed wrong setup hash needs async rejection', async () => {
  for (const original of [reviewable.requirements, rejected.requirements, featureRequirements]) {
    const value = clone(original);
    value.setupHash = wrongHash;
    c.RequirementsSchema.parse(value);
    await assert.rejects(c.verifyRequirements(value), /Requirements hash mismatch/);
    assert.equal(sha(original.setupCanonicalJson), original.setupHash);
  }
});

test('[DISPATCH_BINDINGS] valid independent dispatches cannot consume another dispatch result', async () => {
  // Alter the dispatch, not the result, so stale bundle/proposal hashes cannot mask an echo defect.
  for (const key of ['runId', 'requestId', 'outputRevisionId', 'attemptId', 'inputRevisionId']) {
    const expected = clone(toolInput);
    expected[key] = `different_${key}`;
    if (key === 'inputRevisionId') for (const artifact of expected.inputArtifacts) artifact.revisionId = expected[key];
    await c.verifyToolInput(expected);
    await assert.rejects(c.verifyToolResult(toolResult, expected), /does not match its dispatched input/, key);
  }
  for (const patch of [{ designId: 'different_design' }, { requirementsVersion: 3 }, { validatorVersion: 'different_validator' }]) {
    const expected = clone(toolInput);
    expected.requirements = await c.createRequirements({ designId: expected.designId, requirementsVersion: 2, setupId: 'resize_centered_v1', lengthMm: 36, validatorVersion: 'fixture_validator_v1', ...patch });
    expected.designId = expected.requirements.designId;
    expected.registryCanonicalJson = expected.requirements.registryCanonicalJson;
    expected.setupCanonicalJson = expected.requirements.setupCanonicalJson;
    await c.verifyToolInput(expected);
    await assert.rejects(c.verifyToolResult(toolResult, expected), /does not match its dispatched input/);
  }
  const expected = clone(toolInput);
  expected.proposal = await fixture('provider-python-proposal');
  await c.verifyToolInput(expected);
  await assert.rejects(c.verifyToolResult(toolResult, expected), /does not match its dispatched input/, 'proposal binding');
});

test('[FIXTURE_PROVENANCE] consistent live relabeling cannot hide a fixture engine', () => {
  const value = candidate();
  value.executionMode = 'live';
  for (const check of value.checks) check.executionMode = 'live';
  for (const artifact of value.artifacts) artifact.executionMode = 'live';
  assert.equal(value.engine.name, 'fixture');
  invalid(c.CandidateSchema, value, 'fixture engine with consistently relabeled records');
  assert.equal(c.CandidateSchema.parse(candidate()).executionMode, 'fixture');
  assert.equal(reviewable.design.acceptedRevisionId, null);
});

test('[ACCEPT_ACTION] explicit action and every CAS/evidence field are mandatory request shape', async () => {
  const value = await fixture('acceptance-request');
  c.AcceptanceRequestSchema.parse(value);
  for (const key of Object.keys(value)) invalid(c.AcceptanceRequestSchema, without(value, key), `missing ${key}`);
  for (const patch of [{ userActionId: '' }, { expectedStateVersion: -1 }, { expectedStateVersion: 1.5 }, { expectedStateVersion: Number.MAX_SAFE_INTEGER + 1 }, { requirementsVersion: 0 }, { accepted: true }]) {
    invalid(c.AcceptanceRequestSchema, { ...value, ...patch }, 'invalid acceptance request shape');
  }
  assert.equal(c.AcceptanceRequestSchema.parse({ ...value, expectedStateVersion: value.expectedStateVersion + 1 }).expectedStateVersion, value.expectedStateVersion + 1);
  // Shape validation cannot determine whether either state version is current or the action authenticated.
});

test('[EXPLICIT_REQUIREMENTS] only confirmed resize intent or the whole fixed setup is allowed', async () => {
  const update = await fixture('requirements-update-request');
  for (const key of Object.keys(update)) invalid(c.RequirementsUpdateRequestSchema, without(update, key), `missing ${key}`);
  const thirty = c.RequirementsUpdateRequestSchema.parse({ ...update, confirmedIntent: { lengthMm: 30 } });
  assert.equal(thirty.confirmedIntent.lengthMm, 30);
  const requirements = await c.createRequirements({ designId: 'acceptance_plate', requirementsVersion: 1, setupId: thirty.setupId, lengthMm: thirty.confirmedIntent.lengthMm });
  assert.equal(requirements.setup.dimensions.lengthMm, 30);
  assert.deepEqual(requirements.setup.holes.centersMm, [[5, 17.5], [25, 17.5]]);
  assert.equal(c.expectedForCheck(requirements, 'margin.end_material').minimumEndMaterialMm, 5);
  for (const extra of [{ minimumEndMaterialMm: 0 }, { threshold: 0 }, { method: 'candidate method' }, { requiredChecks: [] }, { widthMm: 20 }, { arbitrary: true }]) {
    invalid(c.RequirementsUpdateRequestSchema, { ...update, ...extra }, 'extra root authority');
    invalid(c.RequirementsUpdateRequestSchema, { ...update, confirmedIntent: { lengthMm: 30, ...extra } }, 'extra intent authority');
    invalid(c.ProviderProposalSchema, { ...toolInput.proposal, ...extra }, 'provider authority');
    invalid(c.ProviderProposalSchema, { kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: 30, ...extra } } }, 'numeric provider authority');
  }
  for (const lengthMm of [25, 201, NaN, Infinity]) invalid(c.RequirementsUpdateRequestSchema, { ...update, confirmedIntent: { lengthMm } }, 'length domain');
  const featureUpdate = { ...update, setupId: 'tactile_feature_v1', confirmedIntent: {} };
  c.RequirementsUpdateRequestSchema.parse(featureUpdate);
  invalid(c.RequirementsUpdateRequestSchema, { ...featureUpdate, confirmedIntent: { lengthMm: 50 } }, 'feature length is not editable');
});

test('[CANONICAL_BYTES] published UTF-8 vectors match independent SHA-256 and preserve coordinate order', async () => {
  const vectors = await fixture('canonical-hashes');
  for (const vector of vectors.valid) {
    const value = c.parseStrictJson(vector.inputJson);
    const canonical = c.canonicalize(value);
    assert.equal(canonical, vector.canonicalJson, vector.name);
    const bytes = Buffer.from(canonical, 'utf8');
    assert.equal(bytes.toString('hex'), vector.utf8Hex, vector.name);
    assert.equal(sha(bytes), vector.sha256, vector.name);
    assert.equal(await c.sha256(bytes), vector.sha256, vector.name);
    assert.equal(await c.hashCanonical(value), vector.sha256, vector.name);
  }
  for (const raw of vectors.invalidCanonicalJson) assert.throws(() => c.canonicalize(JSON.parse(raw)));
  const cycle = {}; cycle.self = cycle;
  let getterCalls = 0;
  const accessor = { get x() { getterCalls++; return 1; } };
  for (const value of [undefined, NaN, Infinity, -Infinity, () => 1, Symbol('x'), 1n, new Array(2), cycle, accessor, new Date(0), { x: undefined }]) assert.throws(() => c.canonicalize(value));
  assert.equal(getterCalls, 0);
  const points = { points: [[35, 17.5], [15, 17.5]] };
  assert.equal(c.canonicalize(points), '{"points":[[35,17.5],[15,17.5]]}');
  const reversed = { points: [...points.points].reverse() };
  assert.notEqual(await c.hashCanonical(points), await c.hashCanonical(reversed));
  assert.notEqual(await c.hashCanonical('é'), await c.hashCanonical('e\u0301'));
  const registry = await fixture('registry-hashes');
  const raw = await readFile(new URL('../../fixtures/api/requirement-registry.json', import.meta.url));
  assert.equal(sha(raw), 'd9de0bbe0c6a03f101d5f9562360ac10d0a4216401533eb9be0b4148c8a9aa33');
  assert.equal(sha(raw), registry.registryFileSha256);
  assert.equal(c.canonicalize(JSON.parse(raw)), registry.registryCanonicalJson);
  assert.equal(sha(registry.registryCanonicalJson), registry.registryHash);
  assert.notEqual(registry.registryHash, registry.registryFileSha256);
});

test('[DUPLICATE_JSON] raw and escaped-equivalent duplicate keys cannot be discarded', async () => {
  for (const raw of (await fixture('canonical-hashes')).invalidJson) assert.throws(() => c.parseStrictJson(raw), raw);
  for (const raw of ['{"x":[{"a":1,"a":2}]}', '{"\\u0061":1,"a":2}']) assert.throws(() => c.parseStrictJson(raw), raw);
  const request = await fixture('acceptance-request');
  const raw = JSON.stringify(request);
  const duplicate = raw.slice(0, -1) + ',"userActionId":"different_action"}';
  await assert.doesNotReject(async () => c.parsePublicRequest(raw, c.AcceptanceRequestSchema));
  assert.throws(() => c.parsePublicRequest(duplicate, c.AcceptanceRequestSchema));
  assert.deepEqual(c.parseStrictJson('{"a":1,"nested":{"a":2}}'), { a: 1, nested: { a: 2 } });
});

test('[MULTIBYTE_SOURCE] Python source is bounded by UTF-8 bytes, never executed', () => {
  const proposal = { kind: 'python_source', changeSummary: 'Synthetic source size probe', source: 'é'.repeat(32768) };
  assert.equal(Buffer.byteLength(proposal.source, 'utf8'), 65536);
  c.ProviderProposalSchema.parse(proposal);
  const tooLarge = { ...proposal, source: proposal.source + 'é' };
  assert(tooLarge.source.length < 65536);
  assert(Buffer.byteLength(tooLarge.source, 'utf8') > 65536);
  invalid(c.ProviderProposalSchema, tooLarge, 'multibyte source exceeds 64 KiB');
  c.ProviderProposalSchema.parse({ ...proposal, source: 'x'.repeat(65536) });
  for (const source of ['', ' \n\t', 'x'.repeat(65537)]) invalid(c.ProviderProposalSchema, { ...proposal, source }, 'blank or oversized source');
});

test('[FEATURE_SETUP] frozen base 5, added 2, total 7 and both full-extent bores stay distinct from resize', async () => {
  const input = { designId: 'feature_contract_probe', requirementsVersion: 1, setupId: 'tactile_feature_v1' };
  // Explicit 50 must fail even though the omitted argument resolves to 50.
  assert.throws(() => c.resolveSetup('tactile_feature_v1', 50), /dimensions are frozen/);
  await assert.rejects(c.createRequirements({ ...input, lengthMm: 50 }), /dimensions are frozen/);
  const requirements = await c.createRequirements(input);
  const setup = c.resolveSetup('tactile_feature_v1');
  assert.deepEqual(requirements.setup, setup);
  assert.deepEqual(setup.dimensions, { lengthMm: 50, widthMm: 35, baseThicknessMm: 5 });
  assert.deepEqual([...setup.requiredChecks].sort(), featureChecks);
  const dimensions = c.expectedForCheck(requirements, 'geometry.requested_dimensions');
  assert.deepEqual(dimensions.boundsMm, [[0, 50], [0, 35], [0, 7]]);
  assert.equal(dimensions.dimensions.baseThicknessMm, 5);
  const feature = c.expectedForCheck(requirements, 'feature.requested_change');
  assert.deepEqual(feature.feature, {
    allowedBoxMm: [[20, 30], [25, 30], [5, 7]], addedSpanRangesMm: [[8, 10], [3, 5], [2, 2]],
    minimumAddedVolumeExclusiveMm3: 1, preserveAllBaselineMaterial: true, unobstructedBores: 'full_candidate_extent',
  });
  assert.equal(feature.maximumOutsideVolumeMm3, 0.01);
  assert.equal(feature.maximumRemovedVolumeMm3, 0.01);
  assert.equal(feature.connected, true);
  const holes = c.expectedForCheck(requirements, 'holes.layout');
  assert.deepEqual(holes.centersMm, [[15, 17.5], [35, 17.5]]);
  assert.equal(holes.centersMode, 'fixed');
  assert.equal(holes.diameterMm, 6);
  assert.equal(holes.spacingMm, 20);
  assert.equal(holes.axis, 'Z');
  assert.equal(holes.unobstructedBores, 'full_candidate_extent');
  const protectedRegion = c.expectedForCheck(requirements, 'interface.protected_region');
  assert.deepEqual(protectedRegion.protectedRegions, { kind: 'z_cylinders', centersMm: [[15, 17.5], [35, 17.5]], radiusMm: 4, zRangeMm: [0, 5] });
  assert.equal(protectedRegion.unobstructedBores, 'full_candidate_extent');
  assert.equal(c.expectedForCheck(requirements, 'export.stl_reopen').unobstructedBores, 'full_candidate_extent');
  assert.equal(c.expectedForCheck(requirements, 'export.editable_reopen').isolatedReopenOrRegeneration, true);
  for (const edit of [
    value => { value.setup.feature.allowedBoxMm[2][1] = 8; },
    value => { value.setup.feature.addedSpanRangesMm[2] = [1, 2]; },
    value => { value.setup.holes.centersMm[0][0] = 14; },
    value => { value.setup.protectedRegions.zRangeMm = [0, 7]; },
    value => { value.setup.minimumEndMaterialMm = 0; },
    value => { value.setup.feature.unobstructedBores = 'base_only'; },
  ]) {
    const changed = clone(requirements);
    edit(changed);
    changed.setupCanonicalJson = c.canonicalize(changed.setup);
    changed.setupHash = sha(changed.setupCanonicalJson);
    assert.throws(() => c.expectedForCheck(changed, 'feature.requested_change'));
  }
  feature.feature.allowedBoxMm[2][1] = 100;
  assert.deepEqual(c.expectedForCheck(requirements, 'feature.requested_change').feature.allowedBoxMm[2], [5, 7]);
  setup.dimensions.lengthMm = 100;
  assert.equal(c.resolveSetup('tactile_feature_v1').dimensions.lengthMm, 50);
  const resize = await c.createRequirements({ ...input, setupId: 'resize_centered_v1', lengthMm: 36 });
  assert.equal(resize.setup.feature, null);
  assert.equal(resize.setup.protectedRegions, null);
  assert.deepEqual(c.expectedForCheck(resize, 'geometry.requested_dimensions').boundsMm, [[0, 36], [0, 35], [0, 5]]);
  assert.deepEqual(c.expectedForCheck(resize, 'holes.layout').centersMm, [[8, 17.5], [28, 17.5]]);
  assert.throws(() => c.expectedForCheck(resize, 'feature.requested_change'));
});

test('[EXPORT_DESCRIPTOR] public descriptors allow only registered ID URLs and reproduce synthetic bytes', async () => {
  const contents = await fixture('synthetic-artifact-bytes');
  assert.equal(contents.executionMode, 'fixture');
  for (const record of [reviewable, rejected]) for (const artifact of record.candidates[0].artifacts) {
    c.ArtifactSchema.parse(artifact);
    assert.equal(Buffer.byteLength(contents.artifacts[artifact.artifactId], 'utf8'), artifact.bytes);
    assert.equal(sha(contents.artifacts[artifact.artifactId]), artifact.sha256);
    for (const href of ['/api/artifacts/different_registered_id', '/api/artifacts/../source', `/api/artifacts/${artifact.artifactId}?download=1`]) {
      invalid(c.ArtifactSchema, { ...artifact, href }, 'wrong public URL');
    }
    for (const key of ['path', 'outputDir', 'privatePath']) invalid(c.ArtifactSchema, { ...artifact, [key]: 'synthetic-private-location' }, 'extra private field');
    invalid(c.ArtifactSchema, { ...artifact, executionMode: 'unavailable' }, 'unavailable artifact');
  }
  const request = await fixture('export-request');
  for (const key of ['acceptanceId', 'manifestId', 'manifestHash']) invalid(c.ExportRequestSchema, without(request, key), `missing ${key}`);
});

test('[TOOL_DEADLINE] serialized input needs a bound, matching canonical text, revisions and proposal', async () => {
  const unbounded = without(without(toolInput, 'deadline'), 'remainingBudgetMs');
  invalid(c.ToolInputSchema, unbounded, 'no deadline or budget');
  c.ToolInputSchema.parse({ ...unbounded, deadline: '2026-09-08T23:00:00.000Z' });
  c.ToolInputSchema.parse({ ...unbounded, remainingBudgetMs: 1 });
  c.ToolInputSchema.parse({ ...toolInput, deadline: '2026-09-08T23:00:00.000Z' });
  for (const remainingBudgetMs of [0, -1, 180001, 0.5, Infinity]) invalid(c.ToolInputSchema, { ...unbounded, remainingBudgetMs }, 'invalid budget');
  invalid(c.ToolInputSchema, { ...unbounded, deadline: 'tomorrow' }, 'invalid deadline');
  for (const key of ['registryCanonicalJson', 'setupCanonicalJson']) invalid(c.ToolInputSchema, { ...toolInput, [key]: toolInput[key] + '\n' }, `changed ${key}`);
  invalid(c.ToolInputSchema, { ...toolInput, outputRevisionId: toolInput.inputRevisionId }, 'same input/output');
  const wrongInput = clone(toolInput);
  wrongInput.inputArtifacts[0].revisionId = 'different_revision';
  invalid(c.ToolInputSchema, wrongInput, 'input artifact revision');
  invalid(c.ToolInputSchema, { ...toolInput, proposal: { kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: 30 } } } }, 'proposal disagrees with confirmed length');
  invalid(c.ToolInputSchema, { ...toolInput, signal: new AbortController().signal }, 'signal is local only');
  const stale = clone(toolInput);
  stale.requirements.setupHash = wrongHash;
  c.ToolInputSchema.parse(stale);
  await assert.rejects(c.verifyToolInput(stale), /Requirements hash mismatch/);
});

test('Failed and unavailable tool results remain error evidence with no successful CAD claim', async () => {
  for (const [status, executionMode, code] of [['failed', 'fixture', 'EXECUTION_FAILED'], ['unavailable', 'unavailable', 'TOOL_UNAVAILABLE']]) {
    const result = { ...clone(toolResult), status, executionMode, engine: null, sourceSha256: null, geometryHash: null, checkBundleHash: null, checks: [], artifacts: [], error: c.safeError(code) };
    const verified = await c.verifyToolResult(result, toolInput);
    assert.equal(verified.status, status);
    assert.equal(verified.geometryHash, null);
    assert.deepEqual(verified.artifacts, []);
    invalid(c.ToolResultSchema, { ...result, error: null }, 'missing error');
    invalid(c.ToolResultSchema, { ...result, status: 'completed' }, 'error evidence cannot become completion');
    const value = { ...candidate(), status: 'failed', executionMode, engine: null, sourceSha256: null, proposalHash: null, geometryHash: null, checkBundleHash: null, checks: [], artifacts: [], error: c.safeError(code) };
    c.CandidateSchema.parse(value);
    invalid(c.CandidateSchema, { ...value, status: 'reviewable' }, 'failed candidate has no reviewable evidence');
  }
});

test('Tool proposal, source and bundle hashes are independently verified without executing Python', async () => {
  const wrongProposal = { ...clone(toolResult), proposalHash: wrongHash };
  c.ToolResultSchema.parse(wrongProposal);
  await assert.rejects(c.verifyToolResult(wrongProposal, toolInput), /Tool proposal hash mismatch/);
  const stale = clone(toolResult);
  stale.checks[0].details = 'Changed synthetic tool detail';
  c.ToolResultSchema.parse(stale);
  await assert.rejects(c.verifyToolResult(stale, toolInput), /Tool check bundle hash mismatch/);
  const input = clone(toolInput);
  input.proposal = await fixture('provider-python-proposal');
  const result = clone(toolResult);
  result.proposal = clone(input.proposal);
  result.proposalHash = sha(c.canonicalize(input.proposal));
  result.sourceSha256 = sha(input.proposal.source);
  for (const artifact of result.artifacts.filter(artifact => ['source', 'editable'].includes(artifact.kind))) {
    artifact.sha256 = result.sourceSha256;
    artifact.bytes = Buffer.byteLength(input.proposal.source, 'utf8');
  }
  result.checkBundleHash = await c.computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId });
  assert.equal((await c.verifyToolResult(result, input)).executionMode, 'fixture');
  result.sourceSha256 = wrongHash;
  for (const artifact of result.artifacts.filter(artifact => ['source', 'editable'].includes(artifact.kind))) artifact.sha256 = wrongHash;
  result.checkBundleHash = await c.computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId });
  c.ToolResultSchema.parse(result);
  await assert.rejects(c.verifyToolResult(result, input), /Tool source hash mismatch/);
});

test('Public request byte cap and strict proposal fields apply before transport integration', async () => {
  const request = await fixture('run-request');
  const raw = JSON.stringify(request);
  c.parsePublicRequest(raw, c.RunRequestSchema);
  const padded = raw + ' '.repeat(8192 - Buffer.byteLength(raw));
  c.parsePublicRequest(padded, c.RunRequestSchema);
  assert.throws(() => c.parsePublicRequest(padded + ' ', c.RunRequestSchema), /exceeds 8 KiB/);
  invalid(c.RunRequestSchema, { ...request, instruction: 'x'.repeat(2001) }, 'instruction cap');
  const proposal = await fixture('provider-python-proposal');
  for (const extra of [{ command: 'synthetic' }, { path: 'synthetic' }, { env: {} }, { requirements: {} }, { threshold: 0 }]) invalid(c.ProviderProposalSchema, { ...proposal, ...extra }, 'Python proposal authority');
});
