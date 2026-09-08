// OUTSIDE_WRAPPER acceptance setup. Synthetic source, measurements and CAD bytes test state/HTTP only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as c from '../../src/shared/contracts-v2.js';
import { HANDLE_DATUM_CANONICAL_JSON, HANDLE_DATUM_SHA256, createHandleRequirements } from '../../src/shared/requirements-handle-v2.js';
import { RunStore, requirementIdentity } from '../../src/server/store.js';
import { verifyAcceptanceResponse, verifyAcceptanceHistory } from '../../src/shared/transport-v2.js';
import { execFileSync } from 'node:child_process';
import { realpath, rm, symlink } from 'node:fs/promises';
import { createApp } from '../../src/server/app.js';
import { ArtifactStore } from '../../src/server/artifacts.js';
import { buildPrototypePackage } from '../../src/server/prototype-package.js';
import { PackageRequestSchema, PACKAGE_HEADERS } from '../../src/shared/package-v2.js';
import { SavedHandleReference } from '../../src/server/handle-reference.js';
import type { PublicReference } from '../../src/server/reference.js';

const engine={name:'build123d' as const,version:'synthetic-test-only',imageDigest:'sha256:'+'1'.repeat(64)};
async function toolResult(input:c.ToolInput,passed=true):Promise<c.ToolResult> {
  assert.equal(input.proposal.kind,'python_source'); if(input.proposal.kind!=='python_source')throw Error('Expected source');
  await mkdir(input.outputDir,{recursive:true});
  const source=input.proposal.source,step='SYNTHETIC STEP '+input.attemptId,stl='SYNTHETIC STL '+input.attemptId;
  const sourceHash=await c.sha256(source),geometryHash=await c.sha256(step),r=input.requirements;
  const checks=r.requiredChecks.map((id,i)=>({checkId:id,revisionId:input.outputRevisionId,...requirementIdentity(r),geometryHash,executionMode:'live' as const,
    state:(!passed&&i===0?'failed':'passed') as 'failed'|'passed',label:id,method:c.checkDefinition(id,r.registryId).method,
    expected:c.expectedForCheck(r,id),measured:{synthetic:true},units:c.checkDefinition(id,r.registryId).units,details:'Synthetic state test; no CAD measurement.'}));
  const definitions=[['source','source.py','text/x-python',source],['editable','editable.py','text/x-python',source],['export','candidate.step','model/step',step],['preview','preview.stl','model/stl',stl]] as const;
  const artifacts=[];
  for(const[kind,fileName,mediaType,data]of definitions){const p=path.join(input.outputDir,fileName);await writeFile(p,data);artifacts.push({kind,fileName,mediaType,path:p,bytes:Buffer.byteLength(data),sha256:await c.sha256(data),executionMode:'live' as const});}
  const result={contractVersion:c.CONTRACT_VERSION,...requirementIdentity(r),requirements:r,runId:input.runId,requestId:input.requestId,designId:input.designId,
    inputRevisionId:input.inputRevisionId,outputRevisionId:input.outputRevisionId,attemptId:input.attemptId,units:'mm' as const,executionMode:'live' as const,status:'completed' as const,
    proposal:input.proposal,proposalHash:await c.hashCanonical(input.proposal),sourceSha256:sourceHash,engine,geometryHash,checkBundleHash:null as string|null,checks,artifacts,error:null};
  result.checkBundleHash=await c.computeCheckBundleHash({...result,revisionId:input.outputRevisionId});return result;
}
async function stateSetup() {
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'wk-bounded-state-')));
  const requirements=await createHandleRequirements({designId:'handle',requirementsVersion:1,setupId:'handle_initial_v1',
    reference:{referenceId:'handle_mount_v1',revisionId:'handle_mount_reference_v1',stepSha256:await c.sha256('SYNTHETIC MOUNT'),datumSpecSha256:HANDLE_DATUM_SHA256}});
  const design:c.Design={designId:'handle',label:'Synthetic state test',units:'mm',stateVersion:0,referenceId:requirements.referenceId,referenceHash:requirements.referenceHash,
    setupId:requirements.setupId,setupHash:requirements.setupHash,baselineRevisionId:'handle_mount_reference_v1',activeRequirementsVersion:1,
    acceptedRevisionId:null,acceptedRequirementsMatch:false,selectedCandidateRevisionId:null,activeRunId:null};
  return {directory,requirements,design,store:new RunStore(directory,design,requirements)};
}
function request(store:RunStore,id:string):c.RunRequest {const d=store.getDesign()!,r=store.getRequirements()!;return {contractVersion:c.CONTRACT_VERSION,requestId:id,designId:d.designId,
  inputRevisionId:d.acceptedRevisionId??d.baselineRevisionId,requirementsVersion:r.requirementsVersion,setupId:r.setupId,units:'mm',instruction:'Synthetic confirmed request'};}
async function start(store:RunStore,id:string){const run=store.getRun(id);await(store.planning as any)(id,run.activeAttemptId);await(store.running as any)(id,run.activeAttemptId);return store.getRun(id);}
async function candidate(s:Awaited<ReturnType<typeof stateSetup>>,run:c.Run,passed:boolean) {
  const draft=s.store.getCandidate(run.candidateRevisionIds.at(-1)!);const r=draft.requirements;
  const data:any={contractVersion:c.CONTRACT_VERSION,runId:run.runId,requestId:run.requestId,designId:run.designId,inputRevisionId:run.inputRevisionId,
    outputRevisionId:draft.revisionId,attemptId:draft.attemptId,units:'mm',requirements:r,proposal:{kind:'python_source',source:'# synthetic '+draft.attemptId,changeSummary:'Synthetic'},outputDir:path.join(s.directory,'stage',draft.attemptId)};
  const result=await toolResult(data,passed);await mkdir(path.join(s.directory,'artifacts'),{recursive:true});const artifacts=[];
  for(const a of result.artifacts){const artifactId='artifact_'+crypto.randomUUID();await writeFile(path.join(s.directory,'artifacts',artifactId),await readFile(a.path));const {path:_,...publicFields}=a;
    artifacts.push({...publicFields,...requirementIdentity(r),artifactId,runId:run.runId,designId:run.designId,revisionId:draft.revisionId,units:'mm' as const,href:'/api/artifacts/'+artifactId});}
  return {...draft,status:passed?'reviewable':'rejected',engine:result.engine,sourceSha256:result.sourceSha256,geometryHash:result.geometryHash,proposalHash:result.proposalHash,
    checkBundleHash:result.checkBundleHash,checks:result.checks,artifacts} as c.Candidate;
}
function accept(store:RunStore,candidate:c.Candidate) {const d=store.getDesign()!;return {contractVersion:c.CONTRACT_VERSION,requestId:'accept_'+crypto.randomUUID(),designId:d.designId,candidateRevisionId:candidate.revisionId,
  requirementsVersion:candidate.requirementsVersion,expectedStateVersion:d.stateVersion,expectedAcceptedRevisionId:d.acceptedRevisionId,registryHash:candidate.registryHash,setupHash:candidate.setupHash,
  geometryHash:candidate.geometryHash!,checkBundleHash:candidate.checkBundleHash!,userActionId:'action_'+crypto.randomUUID()};}
async function packageState(refined = false) {
  const s = await stateSetup();
  const input = path.join(s.directory, 'inputs');
  await mkdir(input);
  await writeFile(path.join(input, 'reference.step'), 'SYNTHETIC MOUNT');
  await writeFile(path.join(input, 'preview.stl'), 'SYNTHETIC MESH');
  await writeFile(path.join(input, 'datums.json'), HANDLE_DATUM_CANONICAL_JSON);
  const reference = await SavedHandleReference.register(s.directory, { stepPath: path.join(input, 'reference.step'), previewPath: path.join(input, 'preview.stl'), datumPath: path.join(input, 'datums.json') });
  const generate = async (id: string) => {
    const run = (await s.store.enqueueRun(request(s.store, id))).run;
    await start(s.store, run.runId);
    const value = await candidate(s, s.store.getRun(run.runId), true);
    await s.store.completeCandidate(value);
    return s.store.acceptRevision(accept(s.store, value));
  };
  const initial = await generate('package_initial');
  const changeRequirements = () => s.store.updateRequirements({ contractVersion: c.CONTRACT_VERSION,
    requestId: 'confirm_' + crypto.randomUUID(), expectedStateVersion: s.store.getDesign()!.stateVersion,
    expectedRequirementsVersion: s.store.getRequirements()!.requirementsVersion, userActionId: 'explicit_test_confirmation',
    setupId: 'handle_refine_v1', confirmedIntent: {} });
  if (refined) await changeRequirements();
  const accepted = refined ? await generate('package_refined') : initial;
  const identity = (pair: typeof accepted) => ({ contractVersion: c.CONTRACT_VERSION, requestId: 'package_test',
    acceptanceId: pair.acceptance.acceptanceId, manifestId: pair.manifest.manifestId, manifestHash: pair.manifest.manifestHash });
  return { ...s, reference, initial, accepted, changeRequirements, identity,
    artifacts: new ArtifactStore(path.join(s.directory, 'artifacts')) };
}
function unzip(bytes: Buffer): Record<string, Buffer> {
  const result = JSON.parse(execFileSync('python3', ['-I', '-c',
    "import base64,io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert len(z.namelist())==len(set(z.namelist())); print(json.dumps({i.filename:base64.b64encode(z.read(i)).decode() for i in z.infolist()}))"],
    { input: bytes, maxBuffer: 40 * 1024 * 1024 }).toString());
  return Object.fromEntries(Object.entries(result).map(([name, value]) => [name, Buffer.from(value as string, 'base64')]));
}

test('package schema accepts unknowns and rejects malformed preferences or extra authority', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/api/v2/package-request.fixture.json', import.meta.url), 'utf8'));
  assert(PackageRequestSchema.safeParse(fixture).success);
  for (const rfq of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: 1_000_001 }, { material: '' }, { finish: 'a\nb' },
    { destination: 'x'.repeat(121) }, { neededBy: '2026-02-30' }, { upload: true }]) {
    assert.equal(PackageRequestSchema.safeParse({ ...fixture, rfq }).success, false);
  }
  assert.equal(PackageRequestSchema.safeParse({ ...fixture, current: true }).success, false);
});

test('refined ZIP preserves every CAD byte and dependency with verifiable inventory, deterministic retries and no RFQ persistence', async () => {
  const s = await packageState(true);
  try {
    const request = { ...s.identity(s.accepted), rfq: { quantity: 2, material: 'Test preference', destination: 'PRIVATE-TEST-LOCATION', neededBy: '2026-10-01' } };
    const before = await readFile(path.join(s.directory, 'state.json'));
    const result = await buildPrototypePackage(s.store, s.artifacts, s.reference, s.accepted.manifest.revisionId, request);
    const files = unzip(result.bytes);
    assert.equal(await c.sha256(result.bytes), result.sha256);
    const inventory = JSON.parse(files['package.json']!.toString());
    assert.equal(inventory.files.length, Object.keys(files).length - 1);
    for (const entry of inventory.files) {
      assert.equal(await c.sha256(files[entry.path]!), entry.sha256);
      assert.equal(files[entry.path]!.length, entry.bytes);
      assert(!entry.path.startsWith('/') && !entry.path.includes('..'));
    }
    for (const a of s.accepted.manifest.artifacts) assert(files[a.fileName]!.equals(await s.artifacts.read(a)));
    const baseline = s.initial.manifest.artifacts.find(a => a.kind === 'export')!;
    assert(files['input/baseline.step']!.equals(await s.artifacts.read(baseline)));
    assert.equal(files['input/reference.step']!.toString(), 'SYNTHETIC MOUNT');
    assert.equal(await c.sha256(files['input/datums.json']!), HANDLE_DATUM_SHA256);
    assert.deepEqual(JSON.parse(files['evidence/manifest.json']!.toString()), s.accepted.manifest);
    assert.deepEqual(JSON.parse(files['evidence/initial-manifest.json']!.toString()), s.initial.manifest);
    const brief = files['PROTOTYPE-BRIEF.txt']!.toString();
    assert.match(brief, /9\/9 passed/); assert.match(brief, /measured not available in summary/);
    assert.match(brief, /mounting hardware and threads TBD/); assert.match(brief, /\/input\/baseline.step/);
    assert.match(brief, /Physical fit and strength have not been tested/);
    assert(!brief.includes('measured 96 mm'));
    const quote = JSON.parse(files['RFQ.json']!.toString());
    assert.equal(quote.preferences.destination, 'PRIVATE-TEST-LOCATION'); assert.equal(quote.preferences.finish, null);
    assert.equal(quote.submitted, false);
    const retry = await buildPrototypePackage(s.store, s.artifacts, s.reference, s.accepted.manifest.revisionId, { ...request, requestId: 'retry_correlation' });
    assert(result.bytes.equals(retry.bytes));
    const other = await buildPrototypePackage(s.store, s.artifacts, s.reference, s.accepted.manifest.revisionId, { ...request, rfq: { quantity: 3 } });
    assert.notEqual(other.sha256, result.sha256);
    assert(unzip(other.bytes)['candidate.step']!.equals(files['candidate.step']!));
    assert((await readFile(path.join(s.directory, 'state.json'))).equals(before));
    assert.equal(s.store.listRuns().length, 2); assert.equal(s.store.listAcceptances().length, 2);
  } finally { await rm(s.directory, { recursive: true, force: true }); }
});

test('package rejects old acceptance, wrong manifest, tampered CAD and missing baseline', async () => {
  const s = await packageState(true), id = s.accepted.manifest.revisionId;
  const build = (identity = s.identity(s.accepted), revision = id) => buildPrototypePackage(s.store, s.artifacts, s.reference, revision, identity);
  const conflict = (e: unknown) => e instanceof Error && 'status' in e && e.status === 409;
  try {
    await assert.rejects(build(s.identity(s.initial), s.initial.manifest.revisionId), conflict);
    await assert.rejects(build({ ...s.identity(s.accepted), manifestHash: '0'.repeat(64) }), conflict);
    await assert.rejects(build(s.identity(s.accepted), 'unaccepted_revision'), conflict);
    const a = s.accepted.manifest.artifacts[0]!, file = path.join(s.directory, 'artifacts', a.artifactId), original = await readFile(file);
    await writeFile(file, 'TAMPERED'); await assert.rejects(build(), conflict); await writeFile(file, original);
    const baseline = s.initial.manifest.artifacts.find(a => a.kind === 'export')!;
    const baselineFile = path.join(s.directory, 'artifacts', baseline.artifactId), baselineBytes = await readFile(baselineFile);
    await rm(baselineFile); await assert.rejects(build(), conflict);
    await symlink(file, baselineFile); await assert.rejects(build(), conflict);
    await rm(baselineFile); await writeFile(baselineFile, baselineBytes);
  } finally { await rm(s.directory, { recursive: true, force: true }); }
});

test('HTTP package validates headers and origin and rejects a concurrent stale build without saving preferences', async () => {
  const s = await packageState();
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  let pause = false;
  const reference: PublicReference = { read: id => s.reference.read(id), describe: async () => {
    if (pause) { entered?.(); await new Promise<void>(resolve => { release = resolve; }); }
    return s.reference.describe();
  } };
  const server = createApp(s.store, s.directory, null, undefined, { reference });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/revisions/${s.accepted.manifest.revisionId}/package`;
  const body = s.identity(s.accepted);
  const post = (value: unknown = body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
  try {
    assert.equal((await post({ ...body, rfq: { neededBy: 'tomorrow' } })).status, 400);
    assert.equal((await post(body, { origin: 'https://unrelated.example' })).status, 403);
    const result = await post(); assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'application/zip');
    assert.equal(result.headers.get(PACKAGE_HEADERS.revisionId), s.accepted.manifest.revisionId);
    assert.equal(result.headers.get(PACKAGE_HEADERS.acceptanceId), body.acceptanceId);
    assert.equal(result.headers.get(PACKAGE_HEADERS.manifestId), body.manifestId);
    assert.equal(result.headers.get(PACKAGE_HEADERS.manifestHash), body.manifestHash);
    assert.equal(result.headers.get(PACKAGE_HEADERS.requestId), body.requestId);
    assert.equal(result.headers.get(PACKAGE_HEADERS.contractVersion), body.contractVersion);
    assert.equal(result.headers.get(PACKAGE_HEADERS.applicability), 'current');
    const bytes = Buffer.from(await result.arrayBuffer());
    assert.equal(result.headers.get(PACKAGE_HEADERS.sha256), await c.sha256(bytes));
    assert.equal(Number(result.headers.get('content-length')), bytes.length);
    assert.match(result.headers.get('content-disposition')!, /prototype.zip/);
    assert(!unzip(bytes)['input/baseline.step']);
    pause = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const pending = post({ ...body, rfq: { destination: 'NEVER-PERSIST' } }); await waiting;
    assert.equal((await post()).status, 503);
    await s.changeRequirements(); release!();
    const stale = await pending; assert.equal(stale.status, 409);
    assert.equal((await stale.json() as any).error.code, 'STATE_CONFLICT');
    assert(!(await readFile(path.join(s.directory, 'state.json'), 'utf8')).includes('NEVER-PERSIST'));
  } finally { release?.(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(s.directory, { recursive: true, force: true }); }
});
