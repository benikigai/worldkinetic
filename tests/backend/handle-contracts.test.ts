// OUTSIDE_WRAPPER: preregistered contract acceptance, synthetic bytes are not CAD evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as c from '../../src/shared/contracts-v2.js';
const handleModule = '../../src/shared/requirements-handle-v2.js';
const integrityModule = '../../src/server/dispatch-integrity.js';
const expected = JSON.parse(await readFile(new URL('./handle-controls.expected.json', import.meta.url), 'utf8'));
const h = () => import(handleModule);
const hash = (s: string) => c.sha256(s);
async function reference() {
  const m = await h();
  return { referenceId: 'handle_mount_v1', revisionId: 'handle_mount_reference_v1',
    stepSha256: await hash('SYNTHETIC TWO PAD STEP, NOT CAD'), datumSpecSha256: m.HANDLE_DATUM_SHA256 };
}
async function accepted() {
  return { acceptanceId: 'initial_acceptance', revisionId: 'initial_revision', artifactId: 'initial_step',
    sha256: await hash('SYNTHETIC ACCEPTED INITIAL STEP, NOT CAD'), requirementsId: 'initial_requirements',
    requirementsVersion: 1, setupHash: await hash('initial_setup'), checkBundleHash: await hash('initial_checks'),
    sourceSha256: await hash('initial_source') };
}
async function requirements(refine = false) {
  return (await h()).createHandleRequirements({ designId: 'handle', requirementsVersion: refine ? 2 : 1,
    setupId: refine ? 'handle_refine_v1' : 'handle_initial_v1', reference: await reference(),
    ...(refine ? { acceptedInitial: await accepted() } : {}) });
}

test('handle registry preserves all released controls and the plate registry bytes', async () => {
  const m = await h();
  const registry = JSON.parse(await readFile(new URL('../../fixtures/api/handle-requirement-registry.json', import.meta.url), 'utf8'));
  assert.deepEqual(registry.geometry, expected);
  assert.equal(registry.registryId, 'handle_sample_v1');
  assert.equal(m.HANDLE_REGISTRY_CANONICAL_JSON, c.canonicalize(registry));
  assert.equal(await hash(m.HANDLE_REGISTRY_CANONICAL_JSON), m.HANDLE_REGISTRY_HASH);
  assert.equal(await hash(m.HANDLE_DATUM_CANONICAL_JSON), m.HANDLE_DATUM_SHA256);
  assert.equal(await c.sha256(await readFile(new URL('../../fixtures/api/requirement-registry.json', import.meta.url))), c.REGISTRY_FILE_SHA256);
});

test('requirements require real hash identities and bind the accepted initial separately', async () => {
  const m = await h(), initial = await requirements(), refined = await requirements(true);
  await c.verifyRequirements(initial); await c.verifyRequirements(refined);
  assert.equal(initial.requiredChecks.length, 8); assert.equal(refined.requiredChecks.length, 9);
  assert.deepEqual([...initial.requiredChecks].sort(), [...expected.requiredInitialChecks].sort());
  assert.deepEqual([...refined.requiredChecks].sort(), [...expected.requiredInitialChecks, 'handle.refinement_delta'].sort());
  assert.equal(initial.registryId, 'handle_sample_v1');
  assert.equal(initial.referenceHash, (await reference()).stepSha256);
  assert.equal(initial.setup.acceptedInitial, null);
  assert.deepEqual(refined.setup.acceptedInitial, await accepted());
  assert.notEqual(refined.setupHash, initial.setupHash);
  assert.notEqual(refined.referenceHash, refined.setup.acceptedInitial.sha256);
  const args = { designId: 'handle', requirementsVersion: 1, setupId: 'handle_initial_v1', reference: await reference() };
  for (const patch of [{ reference: undefined }, { reference: {...args.reference,stepSha256:null} },
    {reference:{...args.reference,datumSpecSha256:'0'.repeat(64)}}, {acceptedInitial:await accepted()},
    {setupId:'handle_refine_v1'}, {lengthMm:130}]) await assert.rejects(m.createHandleRequirements({...args,...patch}));
  for (const change of [
    (r: any) => { r.registryHash = '0'.repeat(64); },
    (r: any) => { r.requiredChecks.pop(); },
  ]) {
    const altered = structuredClone(refined); change(altered);
    await assert.rejects(c.verifyRequirements(altered));
  }
  const changed = structuredClone(refined); changed.setup.acceptedInitial.sha256 = 'f'.repeat(64);
  await assert.rejects(c.verifyRequirements(changed));
});

async function dispatch(refine = false) {
  const m = await h(), r = await requirements(refine), root = await mkdtemp(path.join(os.tmpdir(), 'wk-handle-contract-'));
  const mountPath = path.join(root, 'reference.step'), datumPath = path.join(root, 'datums.json');
  await writeFile(mountPath, 'SYNTHETIC TWO PAD STEP, NOT CAD'); await writeFile(datumPath, m.HANDLE_DATUM_CANONICAL_JSON);
  const a = await accepted(), baselinePath = path.join(root, 'baseline.step');
  await writeFile(baselinePath, 'SYNTHETIC ACCEPTED INITIAL STEP, NOT CAD');
  return { contractVersion:c.CONTRACT_VERSION,runId:'handle_run',requestId:'handle_request',designId:'handle',
    inputRevisionId:refine?a.revisionId:'handle_mount_reference_v1',outputRevisionId:'handle_output',attemptId:'handle_attempt',units:'mm',
    requirements:r,registryCanonicalJson:r.registryCanonicalJson,setupCanonicalJson:r.setupCanonicalJson,
    proposal:{kind:'python_source',source:'print("SYNTHETIC ONLY")\n',changeSummary:'Synthetic contract test'},
    outputDir:path.join(root,'out'),remainingBudgetMs:180000,
    referenceArtifact:{referenceId:'handle_mount_v1',artifactId:'mount_step',revisionId:'handle_mount_reference_v1',kind:'reference',units:'mm',path:mountPath,sha256:r.referenceHash,
      datumSpec:{path:datumPath,sha256:m.HANDLE_DATUM_SHA256}},
    inputArtifacts:refine?[{artifactId:a.artifactId,revisionId:a.revisionId,kind:'export',units:'mm',path:baselinePath,sha256:a.sha256}]:[] };
}

test('dispatch separates immutable mount reference from exact current accepted initial artifacts', async () => {
  const initial = await dispatch(), refined = await dispatch(true);
  await c.verifyToolInput(initial); await c.verifyToolInput(refined);
  const integrity = await import(integrityModule);
  await integrity.verifyDispatchArtifacts(initial); await integrity.verifyDispatchArtifacts(refined);
  for (const alter of [
    (d: any) => { delete d.referenceArtifact; },
    (d: any) => { d.referenceArtifact.revisionId = d.inputRevisionId; },
    (d: any) => { d.referenceArtifact.sha256 = d.inputArtifacts[0].sha256; },
    (d: any) => { d.inputArtifacts[0].revisionId = 'another_revision'; },
    (d: any) => { d.inputArtifacts[0].artifactId = 'another_artifact'; },
    (d: any) => { d.inputArtifacts = []; },
    (d: any) => { d.inputRevisionId = 'unaccepted_revision'; },
    (d: any) => { d.remainingBudgetMs = 180001; },
    (d: any) => { d.proposal = {kind:'numeric_operation',operation:{name:'resize_plate',parameters:{lengthMm:36}}}; },
  ]) { const d=structuredClone(refined);alter(d);await assert.rejects(c.verifyToolInput(d)); }
  const badInitial=structuredClone(initial);badInitial.inputArtifacts=refined.inputArtifacts;
  await assert.rejects(c.verifyToolInput(badInitial));
});

test('dispatch byte guard rejects missing, substituted, symlinked reference and accepted baseline bytes', async () => {
  const integrity = await import(integrityModule);
  for (const target of ['mount','datum','baseline'] as const) {
    const d=await dispatch(true);
    const file=target==='mount'?d.referenceArtifact.path:target==='datum'?d.referenceArtifact.datumSpec.path:d.inputArtifacts[0]!.path;
    await writeFile(file,'SUBSTITUTED');
    await assert.rejects(integrity.verifyDispatchArtifacts(d),target);
  }
  const missing=await dispatch();missing.referenceArtifact.path+='.missing';
  await assert.rejects(integrity.verifyDispatchArtifacts(missing));
  const linked=await dispatch();const link=linked.referenceArtifact.path+'.link';
  await symlink(linked.referenceArtifact.path,link);linked.referenceArtifact.path=link;
  await assert.rejects(integrity.verifyDispatchArtifacts(linked));
});

test('shared public envelopes accept handle identity without weakening explicit acceptance or authority', async () => {
  const r=await requirements();
  const request={contractVersion:c.CONTRACT_VERSION,requestId:'handle_public',designId:'handle',inputRevisionId:'handle_mount_reference_v1',requirementsVersion:1,setupId:r.setupId,units:'mm',instruction:'Generate the confirmed handle'};
  c.RunRequestSchema.parse(request);
  for (const extra of [{acceptedRevisionId:'silent_accept'}, {outputDir:'/private'}, {referenceHash:'0'.repeat(64)}]) assert.equal(c.RunRequestSchema.safeParse({...request,...extra}).success,false);
  c.RequirementsUpdateRequestSchema.parse({contractVersion:c.CONTRACT_VERSION,requestId:'handle_confirm',expectedStateVersion:0,expectedRequirementsVersion:1,userActionId:'explicit_confirm',setupId:'handle_initial_v1',confirmedIntent:{}});
  c.RequirementsUpdateRequestSchema.parse({contractVersion:c.CONTRACT_VERSION,requestId:'handle_refine_confirm',expectedStateVersion:4,expectedRequirementsVersion:1,userActionId:'explicit_refine_confirm',setupId:'handle_refine_v1',confirmedIntent:{}});
  for (const id of r.requiredChecks) {
    const definition=c.checkDefinition(id,r.registryId);
    assert.ok(definition.method.length>15);assert.ok(definition.units.length);
    assert.notEqual(c.expectedForCheck(r,id),undefined);
  }
  const fixture=JSON.parse(await readFile(new URL('../../fixtures/api/v2/handle-reviewable.fixture.json',import.meta.url),'utf8'));
  c.BootstrapSchema.parse(fixture);
  assert.equal(fixture.executionMode,'fixture');assert.equal(fixture.design.acceptedRevisionId,null);
  for (const candidate of fixture.candidates) {await c.verifyCandidateEvidence(candidate);assert.equal(candidate.executionMode,'fixture');}
});
