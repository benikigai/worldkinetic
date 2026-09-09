// OUTSIDE_WRAPPER: deterministic fake HTTP only. These bytes and measurements are not CAD evidence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as c from '../../src/shared/contracts-v2.js';
import { verifyAcceptanceResponse } from '../../src/shared/transport-v2.js';

const controllerPath = '../../src/client/workspace/live-state.js';
const presentationPath = '../../src/client/workspace/live-presentation.js';
const copy = <T>(v: T): T => structuredClone(v);
const wire = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const bytes = (s: string) => new TextEncoder().encode(s);
const identity = (r: any) => Object.fromEntries(['requirementsId','requirementsVersion','registryId','registryHash','setupId','setupHash','referenceHash','validatorVersion'].map(k => [k,r[k]]));
const fixture = JSON.parse(await readFile(new URL('../../fixtures/api/v2/handle-flow.fixture.json', import.meta.url), 'utf8'));

async function service() {
  let count = 0;
  const responseFault = { loseAcceptance: false };
  const bodies = new Map<string, Uint8Array>();
  const referenceArtifacts = await Promise.all([
    ['step', 'model/step', bytes('DETERMINISTIC_FAKE_HTTP_ONLY mount STEP, invalid CAD')],
    ['stl', 'model/stl', bytes('DETERMINISTIC_FAKE_HTTP_ONLY mount STL, invalid CAD')],
    ['datums', 'application/json', bytes(c.HANDLE_DATUM_CANONICAL_JSON)],
  ].map(async ([suffix, mediaType, value]) => {
    const artifactId = `reference_test_handle_${suffix}`, body = value as Uint8Array;
    bodies.set(artifactId, body);
    return { artifactId, fileName: `${suffix}.test`, mediaType, bytes: body.length, sha256: await c.sha256(body), href: `/api/reference/artifacts/${artifactId}` };
  }));
  const reference = { contractVersion: c.CONTRACT_VERSION, reference: { referenceId: 'handle_mount_v1', revisionId: 'handle_mount_reference_v1',
    units: 'mm', provenance: 'trusted_mount_reference', datumSpecSha256: c.HANDLE_DATUM_SHA256, artifacts: referenceArtifacts } };
  const descriptor = { referenceId: 'handle_mount_v1' as const, revisionId: 'handle_mount_reference_v1' as const,
    stepSha256: referenceArtifacts[0].sha256, datumSpecSha256: c.HANDLE_DATUM_SHA256 } as const;
  const r = await c.createHandleRequirements({ designId: 'fake_handle', requirementsVersion: 1, setupId: 'handle_initial_v1', reference: descriptor });
  const state: any = { contractVersion: c.CONTRACT_VERSION, scopeStatus: 'selected', executionMode: 'live', unavailableReason: null,
    requirements: r, runs: [], candidates: [], design: { designId: r.designId, label: 'DETERMINISTIC_FAKE_HTTP_ONLY handle', units: 'mm',
      stateVersion: 0, referenceId: r.referenceId, referenceHash: r.referenceHash, setupId: r.setupId, setupHash: r.setupHash,
      baselineRevisionId: descriptor.revisionId, activeRequirementsVersion: 1, selectedCandidateRevisionId: null,
      acceptedRevisionId: null, acceptedRequirementsMatch: false, activeRunId: null } };
  const history: any = { contractVersion: c.CONTRACT_VERSION, acceptances: [], manifests: [] };
  const calls: { method: string; path: string; body: any }[] = [], events: any[] = [];
  const receipts = new Map<string, { key: string; value: any }>();
  const overrides = new Map<string, (() => Response | Promise<Response>)[]>();
  function observe(type: string, run: any = null, candidate: any = null, acceptanceId: string | null = null) {
    events.push(c.EventSchema.parse({ contractVersion: c.CONTRACT_VERSION, eventId: events.length + 1,
      designId: r.designId, stateVersion: state.design.stateVersion, requirementsVersion: state.requirements.requirementsVersion,
      units: 'mm', executionMode: 'live', createdAt: '2026-09-08T21:00:00.000Z', type,
      runId: run?.runId ?? null, revisionId: candidate?.revisionId ?? null, run: copy(run), candidate: copy(candidate), acceptanceId }));
  }
  function acceptedInitial() {
    const a = history.acceptances.at(-1), candidate = a.candidate;
    const step = candidate.artifacts.find((a: any) => a.mediaType === 'model/step');
    return { acceptanceId: a.acceptanceId, revisionId: candidate.revisionId, artifactId: step.artifactId, sha256: step.sha256,
      requirementsId: candidate.requirementsId, requirementsVersion: candidate.requirementsVersion, setupHash: candidate.setupHash,
      sourceSha256: candidate.sourceSha256, checkBundleHash: candidate.checkBundleHash };
  }
  async function complete(rejected = false) {
    const run = state.runs.at(-1); assert.ok(run, 'Frontend must explicitly submit a run first');
    const refined = state.requirements.setupId === 'handle_refine_v1';
    const template = copy((refined ? fixture.refinementReviewable : fixture.initialAccepted).bootstrap.candidates.at(-1));
    const candidate: any = { ...template, ...identity(state.requirements), designId: r.designId, runId: run.runId, requestId: run.requestId,
      attemptId: run.attemptIds[0], revisionId: run.candidateRevisionIds[0], inputRevisionId: run.inputRevisionId,
      requirements: copy(state.requirements), executionMode: 'live', status: rejected ? 'rejected' : 'reviewable',
      engine: { name: 'build123d', version: 'DETERMINISTIC_FAKE_HTTP_ONLY', imageDigest: template.engine.imageDigest } };
    candidate.artifacts = await Promise.all(template.artifacts.map(async (a: any, i: number) => {
      const artifactId = `${candidate.revisionId}_${i}`;
      const value = bytes(`DETERMINISTIC_FAKE_HTTP_ONLY ${candidate.revisionId} ${a.kind === 'editable' ? 'source' : a.kind}`);
      bodies.set(artifactId, value);
      return { ...a, ...identity(state.requirements), artifactId, designId: r.designId, runId: run.runId,
        revisionId: candidate.revisionId, executionMode: 'live', bytes: value.length, sha256: await c.sha256(value), href: `/api/artifacts/${artifactId}` };
    }));
    candidate.geometryHash = candidate.artifacts.find((a: any) => a.mediaType === 'model/step').sha256;
    candidate.sourceSha256 = candidate.artifacts.find((a: any) => a.kind === 'source').sha256;
    candidate.checks = state.requirements.requiredChecks.map((checkId: string) => ({ ...template.checks.find((x: any) => x.checkId === checkId),
      ...identity(state.requirements), checkId, revisionId: candidate.revisionId, geometryHash: candidate.geometryHash,
      executionMode: 'live', state: rejected && checkId === 'handle.grip_clearance' ? 'failed' : 'passed',
      expected: c.expectedForCheck(state.requirements, checkId) }));
    candidate.checkBundleHash = await c.computeCheckBundleHash(candidate);
    await c.verifyCandidateEvidence(candidate);
    state.candidates.push(candidate); state.design.selectedCandidateRevisionId = candidate.revisionId; state.design.activeRunId = null;
    state.design.stateVersion++; run.status = 'completed'; run.activeAttemptId = null;
    observe(`candidate.${candidate.status}`, run, candidate); observe('run.completed', run, candidate);
  }
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://fake.test'), path = url.pathname + url.search, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    const override = overrides.get(`${method} ${path}`)?.shift(); if (override) return override();
    const fail = () => wire({ contractVersion: c.CONTRACT_VERSION, error: c.safeError('STATE_CONFLICT') }, 409);
    if (method === 'GET') {
      if (path === '/api/reference') return wire(reference);
      if (path === '/api/bootstrap') return wire(c.BootstrapSchema.parse(state));
      if (path === '/api/acceptances') return wire(history);
      if (url.pathname === '/api/events') return wire({ contractVersion: c.CONTRACT_VERSION, events: events.filter(e => e.eventId > Number(url.searchParams.get('after'))) });
      const id = path.split('/').at(-1)!, artifact = [...referenceArtifacts, ...state.candidates.flatMap((c: any) => c.artifacts)].find(a => a.artifactId === id);
      if (artifact && bodies.has(id)) return new Response(bodies.get(id)!.slice(), { headers: { 'content-type': artifact.mediaType,
        'content-length': String(artifact.bytes), 'x-worldkinetics-revision': artifact.revisionId ?? descriptor.revisionId,
        ...(artifact.executionMode ? { 'x-worldkinetics-execution': artifact.executionMode } : {}),
        'x-worldkinetics-applicability': artifact.revisionId ? artifact.revisionId === state.design.acceptedRevisionId && state.design.acceptedRequirementsMatch ? 'current' : 'historical' : 'trusted_mount_reference' } });
      return wire({ contractVersion: c.CONTRACT_VERSION, error: c.safeError('EXPORT_FAILED') }, 404);
    }
    const key = c.canonicalize({ method, path, body }), prior = receipts.get(body.requestId);
    if (prior) return prior.key === key ? wire({ ...prior.value, reused: true }) : fail();
    let value: any;
    if (method === 'PATCH') {
      c.RequirementsUpdateRequestSchema.parse(body);
      assert.deepEqual(body.confirmedIntent, {}, 'Browser confirms the fixed stage and cannot inject geometry or acceptedInitial');
      if (body.expectedStateVersion !== state.design.stateVersion || body.expectedRequirementsVersion !== state.requirements.requirementsVersion) return fail();
      const common = { designId: r.designId, requirementsVersion: state.requirements.requirementsVersion + 1, reference: descriptor };
      if (body.setupId === 'handle_initial_v1' && !state.design.acceptedRevisionId) state.requirements = await c.createHandleRequirements({ ...common, setupId: body.setupId });
      else if (body.setupId === 'handle_refine_v1' && history.acceptances.at(-1)?.requirements.setupId === 'handle_initial_v1') state.requirements = await c.createHandleRequirements({ ...common, setupId: body.setupId, acceptedInitial: acceptedInitial() });
      else return fail();
      Object.assign(state.design, { setupId: state.requirements.setupId, setupHash: state.requirements.setupHash,
        activeRequirementsVersion: state.requirements.requirementsVersion, stateVersion: state.design.stateVersion + 1,
        selectedCandidateRevisionId: null, activeRunId: null, acceptedRequirementsMatch: false });
      value = { contractVersion: c.CONTRACT_VERSION, reused: false, design: copy(state.design), requirements: copy(state.requirements) };
      observe('requirements.updated');
    } else if (path === '/api/runs') {
      c.RunRequestSchema.parse(body);
      assert.equal(body.inputRevisionId, state.requirements.setup.acceptedInitial?.revisionId ?? descriptor.revisionId);
      assert.equal(body.requirementsVersion, state.requirements.requirementsVersion);
      if (state.executionMode !== 'live') return wire({ contractVersion: c.CONTRACT_VERSION, error: c.safeError('TOOL_UNAVAILABLE') }, 503);
      const n = ++count, runId = `fake_handle_run_${n}`;
      const run = { ...copy(fixture.initialAccepted.bootstrap.runs[0]), ...body, ...identity(state.requirements), runId, executionMode: 'live', status: 'queued',
        attemptIds: [`fake_attempt_${n}`], activeAttemptId: `fake_attempt_${n}`, candidateRevisionIds: [`fake_handle_${n}`] };
      state.runs.push(run); state.design.activeRunId = runId; state.design.selectedCandidateRevisionId = null; state.design.stateVersion++;
      value = { contractVersion: c.CONTRACT_VERSION, reused: false, run: copy(run) }; observe('run.queued', run);
    } else if (path.endsWith('/accept')) {
      c.AcceptanceRequestSchema.parse(body);
      if (body.expectedStateVersion !== state.design.stateVersion || body.expectedAcceptedRevisionId !== state.design.acceptedRevisionId || body.candidateRevisionId !== state.design.selectedCandidateRevisionId) return fail();
      const candidate = state.candidates.find((c: any) => c.revisionId === body.candidateRevisionId);
      if (candidate.status !== 'reviewable') return fail();
      state.design.stateVersion++; state.design.acceptedRevisionId = candidate.revisionId; state.design.acceptedRequirementsMatch = true;
      const acceptance = { contractVersion: c.CONTRACT_VERSION, acceptanceId: `fake_accept_${state.design.stateVersion}`, request: body,
        acceptedAt: '2026-09-08T21:00:00.000Z', stateVersion: state.design.stateVersion, candidate: copy(candidate), requirements: copy(candidate.requirements) };
      const payload = { contractVersion: c.CONTRACT_VERSION, manifestId: `fake_manifest_${state.design.stateVersion}`, acceptanceId: acceptance.acceptanceId,
        designId: r.designId, runId: candidate.runId, revisionId: candidate.revisionId, requirements: candidate.requirements,
        checkBundleHash: candidate.checkBundleHash, geometryHash: candidate.geometryHash, sourceSha256: candidate.sourceSha256,
        proposalHash: candidate.proposalHash, engine: candidate.engine, checks: candidate.checks, changeSummary: candidate.changeSummary,
        units: 'mm', artifacts: candidate.artifacts };
      const manifest = { ...payload, manifestHash: await c.hashCanonical(payload) };
      value = await verifyAcceptanceResponse({ contractVersion: c.CONTRACT_VERSION, reused: false, acceptance, manifest }, body);
      history.acceptances.push(acceptance); history.manifests.push(manifest); observe('revision.accepted', null, null, acceptance.acceptanceId);
    } else if (path.endsWith('/export')) {
      c.ExportRequestSchema.parse(body);
      const acceptance = history.acceptances.at(-1), manifest = history.manifests.at(-1);
      if (!state.design.acceptedRequirementsMatch || body.acceptanceId !== acceptance.acceptanceId || body.manifestId !== manifest.manifestId) return fail();
      value = { contractVersion: c.CONTRACT_VERSION, reused: false, acceptance, manifest };
    } else return fail();
    receipts.set(body.requestId, { key, value: copy(value) });
    if (path.endsWith('/accept') && responseFault.loseAcceptance) {
      responseFault.loseAcceptance = false;
      throw new Error('Acceptance committed, response connection lost');
    }
    return wire(value, path === '/api/runs' ? 202 : 200);
  };
  const { createLiveWorkspaceController } = await import(controllerPath);
  return { controller: createLiveWorkspaceController({ fetch: fetcher }), state, history, reference, bodies, calls, overrides, complete, acceptedInitial, responseFault };
}

async function initial(accept = false) {
  const s = await service(); await s.controller.load();
  s.controller.setDraft({ instruction: 'Create a handle from the confirmed sample mounting brief.' });
  await s.controller.confirmRequirements('handle_initial_v1'); await s.controller.requestRun(); await s.complete(); await s.controller.refresh();
  if (accept) await s.controller.acceptRevision();
  return s;
}

test('handle reference loads with trusted-mount identity; drafts cannot skip explicit initial confirmation', async () => {
  const s = await service(); await s.controller.load();
  assert.equal(s.controller.snapshot().trusted, true, 'Handle reference header and union must be supported');
  assert.equal(s.controller.snapshot().reference.revisionId, 'handle_mount_reference_v1');
  assert.equal(s.controller.snapshot().draft.lengthMm, '', 'No invented plate length for a handle');
  s.controller.setDraft({ instruction: 'Create the initial handle' });
  assert.equal(s.controller.snapshot().canRun, false);
  await s.controller.requestRun(); assert.ok(s.calls.every(c => c.method === 'GET'));
  await Promise.all([s.controller.confirmRequirements('handle_initial_v1'), s.controller.confirmRequirements('handle_initial_v1')]);
  assert.equal(s.calls.filter(c => c.method === 'PATCH').length, 1);
  assert.equal(s.calls.filter(c => c.path === '/api/runs').length, 0);
  assert.equal(s.controller.snapshot().canRun, true);
});

test('initial and final handle have separate explicit acceptance and frozen refinement input', async () => {
  const s = await initial(); const initialId = s.state.design.selectedCandidateRevisionId;
  assert.equal(s.state.candidates[0].checks.length, 8); assert.equal(s.state.design.acceptedRevisionId, null);
  await s.controller.acceptRevision(); assert.equal(s.state.design.acceptedRevisionId, initialId);
  s.controller.setDraft({ instruction: 'Broaden the grip and add a thumb rest, keeping mounts and finger gap.' });
  assert.equal(s.controller.snapshot().canRun, false, 'Another prompt cannot accept or switch stages');
  await s.controller.confirmRequirements('handle_refine_v1');
  assert.equal(s.state.design.acceptedRevisionId, initialId);
  assert.deepEqual(s.state.requirements.setup.acceptedInitial, s.acceptedInitial());
  assert.equal(s.controller.snapshot().canDownload, false, 'Initial acceptance is historical after stage confirmation');
  const patches = s.calls.filter(c => c.method === 'PATCH'); assert.deepEqual(patches.map(c => c.body.confirmedIntent), [{},{}]);
  await s.controller.requestRun(); assert.equal(s.state.runs.at(-1).inputRevisionId, initialId);
  await s.complete(); await s.controller.refresh();
  const finalId = s.state.design.selectedCandidateRevisionId;
  assert.equal(s.state.candidates.at(-1).checks.length, 9); assert.notEqual(finalId, initialId);
  assert.equal(s.state.design.acceptedRevisionId, initialId);
  await s.controller.acceptRevision(); assert.equal(s.state.design.acceptedRevisionId, finalId);
  s.state.executionMode = 'unavailable'; await s.controller.refresh(); s.controller.selectRevision(initialId);
  assert.equal(s.controller.snapshot().canDownload, true);
  const artifact = s.history.manifests.at(-1).artifacts.find((a: any) => a.mediaType === 'model/step');
  const result = await s.controller.exportArtifact(artifact.artifactId); assert.ok(result);
  assert.equal(result.artifact.revisionId, finalId); assert.equal(await c.sha256(new Uint8Array(result.bytes)), artifact.sha256);
  assert.equal(s.controller.snapshot().canRun, false, 'Refined final cannot masquerade as an accepted initial');
});

test('refinement stage is unavailable without a genuine initial acceptance and stays gated by runtime availability', async () => {
  const s = await initial();
  const before = s.calls.length; await s.controller.confirmRequirements('handle_refine_v1');
  assert.equal(s.calls.length, before, 'Do not offer an impossible stage based only on setup enum');
  await s.controller.acceptRevision(); s.state.executionMode = 'unavailable'; await s.controller.refresh();
  s.controller.setDraft({ instruction: 'Refine the grip' }); await s.controller.confirmRequirements('handle_refine_v1');
  assert.equal(s.controller.snapshot().canRun, false);
  const count = s.calls.length; await s.controller.requestRun(); assert.equal(s.calls.length,count);
});

test('forged accepted-initial binding with valid canonical hashes cannot enable refinement', async () => {
  const s = await initial(true); await s.controller.confirmRequirements('handle_refine_v1');
  const forged = { ...s.state.requirements.setup.acceptedInitial, sourceSha256: 'f'.repeat(64) };
  s.state.requirements = await c.createHandleRequirements({ designId: s.state.design.designId,
    requirementsVersion: s.state.requirements.requirementsVersion, setupId: 'handle_refine_v1',
    reference: s.state.requirements.setup.reference, acceptedInitial: forged });
  s.state.design.setupHash = s.state.requirements.setupHash;
  await s.controller.refresh();
  assert.equal(s.controller.snapshot().trusted,false); assert.equal(s.controller.snapshot().canRun,false);
  assert.ok(s.controller.snapshot().error);
});

test('handle stage CAS conflicts retain the draft and do not automatically retry or generate', async () => {
  const s = await initial(true); s.controller.setDraft({ instruction: 'Keep this refinement draft' });
  s.overrides.set(`PATCH /api/designs/${s.state.design.designId}/requirements`, [() => wire({ contractVersion: c.CONTRACT_VERSION, error: c.safeError('STATE_CONFLICT') },409)]);
  const before = s.calls.length; await s.controller.confirmRequirements('handle_refine_v1');
  assert.equal(s.controller.snapshot().draft.instruction,'Keep this refinement draft');
  assert.equal(s.calls.slice(before).filter(c => c.method === 'PATCH').length,1);
  assert.equal(s.calls.slice(before).filter(c => c.path === '/api/runs').length,0);
  assert.equal(s.controller.snapshot().canRun,false);
});

test('handle rejected and unrendered candidates cannot acquire presentation acceptance', async () => {
  const s = await service(); await s.controller.load(); s.controller.setDraft({ instruction: 'Create handle' });
  await s.controller.confirmRequirements('handle_initial_v1'); await s.controller.requestRun(); await s.complete(true); await s.controller.refresh();
  assert.equal(s.controller.snapshot().canAccept,false);
  const { createLivePresentation } = await import(presentationPath), view = createLivePresentation();
  const result = view.update(s.controller.snapshot(),'candidate'); view.rendered(result.previewKey);
  assert.equal(view.update(s.controller.snapshot(),'candidate').canAccept,false);
  const ready = await initial(), another = createLivePresentation();
  assert.equal(another.update(ready.controller.snapshot(),'candidate').canAccept,false);
});

test('reference datum corruption and unavailable handle artifact never substitute plate geometry', async () => {
  const s = await service(); const datum = s.reference.reference.artifacts.find(a => a.mediaType === 'application/json')!;
  s.bodies.set(datum.artifactId,bytes('not the registered datum'));
  await s.controller.load(); assert.equal(s.controller.snapshot().trusted,false);
  assert.ok(s.calls.every(c => !c.path.includes('/fixtures/')));
  const ready = await initial(), stl = ready.state.candidates[0].artifacts.find((a: any) => a.mediaType === 'model/stl');
  ready.overrides.set(`GET ${stl.href}`, [() => new Response('<html>sign in</html>', {headers:{'content-type':'text/html'}})]);
  assert.equal(await ready.controller.preview(ready.state.design.selectedCandidateRevisionId),null);
  assert.ok(ready.controller.snapshot().error);
});

// OUTSIDE_WRAPPER: real DOM event callbacks with deterministic fake HTTP and an explicit fake renderer.
// This establishes UI action boundaries, not a browser/WebGL or live CAD result.
for (const recovery of ['direct', 'refresh', 'retry'] as const) test(`public handle controls preserve explicit actions and expose accepted files after ${recovery}`, async () => {
  class Element {
    children: Element[] = []; dataset: Record<string,string> = {}; textContent = ''; value = ''; className = '';
    disabled = false; hidden = false; open = false; listeners = new Map<string, Array<() => void>>();
    constructor(readonly tag: string) {}
    append(...items: Element[]) { this.children.push(...items); }
    prepend(...items: Element[]) { this.children.unshift(...items); }
    replaceChildren(...items: Element[]) { this.children = items; }
    querySelectorAll() { return []; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name,[...(this.listeners.get(name)??[]),callback]); }
    click() { assert.equal(this.disabled,false, `${this.tag} disabled`); assert.equal(this.hidden,false,`${this.tag} hidden`); for(const callback of this.listeners.get('click')??[]) callback(); }
    key(options: Record<string,unknown>) { let prevented=false; for(const callback of this.listeners.get('keydown')??[]) (callback as (event: unknown)=>void)({key:'Enter',preventDefault:()=>{prevented=true;},...options}); return prevented; }
  }
  const s=await service(); await s.controller.load();
  const nodes=new Map<string,Element>(); const node=(id:string)=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id)!;};
  node('live-comparison').value='baseline';
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:node,createElement:(tag:string)=>new Element(tag)}});
  const abort=new AbortController();
  const settled=async(allowError=false)=>{for(let n=0;n<100 && (s.controller.snapshot().busy||s.controller.snapshot().loading);n++) await new Promise(resolve=>setTimeout(resolve,2)); assert.equal(s.controller.snapshot().busy,false); assert.equal(s.controller.snapshot().loading,false); if(!allowError) assert.equal(s.controller.snapshot().error,null);};
  const {mountLive}=await import('../../src/client/workspace/live.js');
  let previewKey:string|null=null;
  try {
    const ui=mountLive(s.controller,abort.signal,update=>{previewKey=update.previewKey;}); ui.open(); await settled();
    assert.equal(node('live-results').hidden,true,'No empty results before generation');
    assert.equal(node('live-earlier-designs').hidden,true,'No empty history before generation');
    assert.equal(node('live-review-sizes').hidden,false,'Empty idea keeps a visible next action');
    assert.equal(node('live-review-sizes').disabled,true,'Empty idea cannot continue');
    assert.match(node('live-run-gate').textContent,/Enter your idea/);
    const mutations=()=>s.calls.filter(call=>call.method!=='GET').length;
    node('live-sample').click(); assert.match(node('live-request').value,/cabinet handle/); assert.equal(mutations(),0);
    for (const modifier of ['shiftKey','altKey','ctrlKey','metaKey','isComposing']) { assert.equal(node('live-request').key({[modifier]:true}),false); assert.equal(node('live-size-review').open,false); }
    node('live-request').key({repeat:true}); assert.equal(node('live-size-review').open,false);
    assert.equal(node('live-request').key({}),true); assert.equal(mutations(),0); assert.equal(node('live-size-review').hidden,false); assert.equal(node('live-size-review').open,true); assert.match(node('live-fixed').textContent,/Hardware unspecified\./);
    assert.match(node('live-status').textContent,/Waiting for you/);
    assert.equal(node('live-review-sizes').hidden,true);
    assert.equal(node('live-confirm').hidden,false);
    assert.equal(node('live-attempt').hidden,true);
    node('live-confirm').click(); await settled(); assert.equal(mutations(),1); assert.equal(s.state.runs.length,0); assert.equal(node('live-review-sizes').textContent,'Create design');
    node('live-request').key({}); node('live-request').key({}); await settled(); assert.equal(s.state.runs.length,1,'Repeated submission cannot create a second logical run');
    assert.equal(node('live-request').disabled,true,'Submitted idea is frozen while active');
    assert.equal(node('live-review-sizes').textContent,'Creating your design…');
    assert.match(node('live-status').textContent,/planning|Generating|queued/);
    assert.equal(node('live-refresh').disabled,false,'Status refresh remains available during a run');
    assert.equal(node('live-review-sizes').disabled,true);
    assert.match(node('live-submitted').textContent,/Submitted idea: Create a cabinet handle/);
    await s.complete(); await s.controller.refresh();
    assert.equal(node('live-inputs').hidden,true,'Review does not show an editable prompt without a submit action');
    assert.equal(node('live-review-request').hidden,false);
    assert.equal(node('live-title').textContent,'Review your design');
    assert.equal(node('live-reviewed-idea').textContent,s.state.runs[0].instruction,'Review shows the request for the displayed revision');
    assert.equal(node('live-review-sizes').hidden,true);
    assert.equal(node('live-request').disabled,true);
    assert.equal(node('live-accept').hidden,true,'Completion cannot accept an unseen design');
    assert.ok(previewKey); ui.rendered(previewKey); assert.equal(node('live-accept').hidden,false);
    node('live-accept').click(); await settled(); assert.equal(s.history.acceptances.length,1);
    assert.equal(s.controller.snapshot().canAccept,false,'An accepted selection does not offer duplicate acceptance');
    assert.equal(node('live-download').hidden,false); assert.equal(node('live-files').hidden,false);
    assert.equal(node('live-inputs').hidden,true,'Completed prompt is removed from the primary flow');
    assert.equal(node('live-size-review').hidden,true,'Completed size brief does not dominate the download stage');
    assert.equal(node('live-title').textContent,'Your design is ready');
    assert.equal(node('make-package').disabled,false,'Verified accepted design enables the package request');
    node('make-fit-notes').value='Initial handle note';
    const initialId=s.state.design.acceptedRevisionId;
    node('live-change').click(); assert.equal(node('live-inputs').hidden,false,'Explicit new change restores the request'); assert.equal(s.history.acceptances.length,1); assert.equal(s.state.requirements.setupId,'handle_initial_v1');
    assert.equal(node('live-review-sizes').hidden,false,'Refinement keeps its next step visible before typing');
    assert.equal(node('live-review-sizes').disabled,true);
    node('live-sample').click(); assert.match(node('live-request').value,/thumb rest/);
    node('live-review-sizes').click(); node('live-confirm').click(); await settled();
    assert.equal(s.state.requirements.setupId,'handle_refine_v1'); assert.equal(s.state.requirements.setup.acceptedInitial.revisionId,initialId);
    assert.equal(node('live-comparison').value,'baseline','Refinement starts with the accepted initial visible as Before');
    assert.equal(node('live-download').hidden,true); assert.equal(s.state.runs.length,1);
    node('live-review-sizes').click(); await settled(); assert.equal(s.state.runs.at(-1).inputRevisionId,initialId);
    await s.complete(); await s.controller.refresh(); assert.equal(node('live-accept').hidden,true);
    assert.ok(previewKey); ui.rendered(previewKey);
    if (recovery === 'refresh') s.overrides.set('GET /api/bootstrap', [() => { throw new Error('Refresh connection lost'); }]);
    if (recovery === 'retry') s.responseFault.loseAcceptance = true;
    node('live-accept').click(); await settled(recovery !== 'direct');
    if (recovery !== 'direct') {
      assert.equal(s.history.acceptances.length,2,'Final acceptance was actually committed before the response failure');
      assert.ok(s.controller.snapshot().error);
      assert.equal(node('live-files').hidden,true,'Unverified recovery cannot expose files');
      const requestId=s.history.acceptances[1].request.requestId;
      node(recovery === 'refresh' ? 'live-refresh' : 'live-retry').click(); await settled();
      assert.equal(s.history.acceptances.length,2,'Recovery must not create another acceptance');
      assert.equal(s.history.acceptances[1].request.requestId,requestId);
      assert.equal(s.controller.snapshot().canDownload,true,'Controller reconciled exact final files');
    }
    assert.equal(s.history.acceptances.length,2); assert.notEqual(s.state.design.acceptedRevisionId,initialId);
    assert.equal(node('make-fit-notes').value,'','Notes cannot silently carry to a different accepted revision');
    assert.equal(node('live-files').hidden,false); assert.equal(node('live-download').disabled,false);
    assert.equal(node('live-inputs').hidden,true,'Verified final recovery keeps the completed prompt out of the download flow');
    assert.equal(node('live-check-details').open,true,'Revision checks are expanded so users can inspect the enforced controls');
    assert.equal(node('live-results').hidden,false,'Actual revision evidence remains available');
    assert.equal(node('live-earlier-designs').hidden,false,'History appears when there are earlier designs');
    assert.equal(node('live-change').hidden,true,'Only the accepted initial supports this refinement stage');
    s.controller.selectRevision(initialId); assert.equal(node('live-download').disabled,false,'History inspection cannot change accepted file eligibility');
  } finally {abort.abort();if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
});

test('Before uses accepted initial artifact identity and retains it through unrelated refreshes', async () => {
  const s=await initial(true); await s.controller.confirmRequirements('handle_refine_v1');
  const {createLivePresentation}=await import('../../src/client/workspace/live-presentation.js');
  const view=createLivePresentation(); const snapshot=s.controller.snapshot();
  const first=view.update(snapshot,'baseline'); assert.equal(first.previewAction,'load');
  const accepted=s.history.acceptances[0].candidate;
  assert.ok(first.previewKey?.includes(accepted.artifacts.find((a:any)=>a.mediaType==='model/stl').artifactId));
  assert.ok(!first.previewKey?.includes('fake_reference_stl'));
  view.rendered(first.previewKey); assert.equal(view.update({...snapshot,loading:true,trusted:false},'baseline').previewAction,'retain');
  assert.equal(view.update(snapshot,'baseline').previewAction,'retain');
  assert.equal(view.update(snapshot,'baseline').canAccept,false);
});

async function packageResponse(s: Awaited<ReturnType<typeof service>>, change?: (headers: Headers) => void) {
  const { PACKAGE_HEADERS: H } = await import('../../src/shared/package-v2.js');
  const request = s.calls.at(-1)!.body;
  const manifest = s.history.manifests.at(-1);
  // Empty ZIP tests transport integrity only, not package contents or actual CAD.
  const archive = new Uint8Array(22); archive.set([80, 75, 5, 6]);
  const headers = new Headers({ 'content-type': 'application/zip', 'content-length': String(archive.length),
    'content-disposition': `attachment; filename="worldkinetics-${manifest.revisionId}-prototype.zip"`,
    [H.contractVersion]: c.CONTRACT_VERSION, [H.requestId]: request.requestId, [H.revisionId]: manifest.revisionId,
    [H.acceptanceId]: request.acceptanceId, [H.manifestId]: request.manifestId, [H.manifestHash]: request.manifestHash,
    [H.applicability]: 'current', [H.sha256]: await c.sha256(archive) });
  change?.(headers);
  return new Response(archive, { headers });
}

function servePackage(s: Awaited<ReturnType<typeof service>>, response: () => Promise<Response> | Response) {
  const path = `/api/revisions/${s.state.design.acceptedRevisionId}/package`;
  s.overrides.set(`POST ${path}`, [response]);
  return path;
}

test('package uses final accepted identity despite historical selection and accepts unknown quote fields', async () => {
  const s = await initial(true), initialId = s.state.design.acceptedRevisionId;
  await s.controller.confirmRequirements('handle_refine_v1');
  s.controller.setDraft({ instruction: 'Broaden grip and add thumb rest' });
  await s.controller.requestRun(); await s.complete(); await s.controller.refresh(); await s.controller.acceptRevision();
  s.controller.selectRevision(initialId);
  const path = servePackage(s, () => packageResponse(s));
  const result = await s.controller.downloadPackage({ quantity: null, material: null });
  assert.ok(result); assert.equal(result.revisionId, s.state.design.acceptedRevisionId);
  assert.equal(s.controller.canSavePackage(result), true);
  assert.equal(s.calls.filter(call => call.path === path).length, 1);
  assert.ok(s.calls.every(call => call.path.startsWith('/api/')), 'No supplier requests');
  assert.equal(s.controller.snapshot().viewedRevisionId, initialId);
  s.state.design.acceptedRequirementsMatch = false; await s.controller.refresh();
  assert.equal(s.controller.canSavePackage(result), false, 'A result cannot be saved after its acceptance becomes inapplicable');
});

for (const [name, mutate] of [
  ['wrong identity', (h: Headers) => h.set('X-WorldKinetics-Acceptance', 'different')],
  ['wrong revision', (h: Headers) => h.set('X-WorldKinetics-Revision', 'different')],
  ['wrong manifest', (h: Headers) => h.set('X-WorldKinetics-Manifest-Hash', '0'.repeat(64))],
  ['wrong request', (h: Headers) => h.set('X-WorldKinetics-Request', 'different')],
  ['wrong contract', (h: Headers) => h.set('X-WorldKinetics-Contract-Version', 'old')],
  ['historical package', (h: Headers) => h.set('X-WorldKinetics-Applicability', 'historical')],
  ['wrong hash', (h: Headers) => h.set('X-WorldKinetics-Package-SHA256', '0'.repeat(64))],
  ['missing length', (h: Headers) => h.delete('content-length')],
  ['oversized', (h: Headers) => h.set('content-length', '999999999')],
  ['truncated bytes', (h: Headers) => h.set('content-length', '23')],
  ['wrong file name', (h: Headers) => h.set('content-disposition', 'attachment; filename="other.zip"')],
] as const) test(`package rejects ${name} without downloading or automatic retry`, async () => {
  const s = await initial(true); const path = servePackage(s, () => packageResponse(s, mutate));
  await assert.rejects(s.controller.downloadPackage());
  assert.equal(s.calls.filter(call => call.path === path).length, 1);
  assert.equal(s.controller.snapshot().busy, false);
});

test('package blocks unaccepted, invalid preferences, unavailable API and in-flight stale state', async () => {
  const s = await initial(); const before = s.calls.length;
  assert.equal(await s.controller.downloadPackage(), null); assert.equal(s.calls.length, before);
  await s.controller.acceptRevision();
  await assert.rejects(s.controller.downloadPackage({ quantity: 0 }));
  const path = servePackage(s, () => wire({ error: 'unavailable' }, 503));
  await assert.rejects(s.controller.downloadPackage(), /503/);
  servePackage(s, async () => { const response = await packageResponse(s); s.state.design.acceptedRequirementsMatch = false; return response; });
  await assert.rejects(s.controller.downloadPackage(), /accepted design changed/);
  assert.equal(s.calls.filter(call => call.path === path).length, 2);
});
