// OUTSIDE_WRAPPER: supervisor preregistration. Fake HTTP evidence never establishes live CAD.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as c from '../../src/shared/contracts-v2.js';
import { verifyAcceptanceResponse } from '../../src/shared/transport-v2.js';

// Local controller seam only; every HTTP record below uses the released shared schemas.
// createLiveWorkspaceController({ fetch }) exposes load(), refresh(), reconnect(), setDraft({lengthMm,instruction}),
// confirmRequirements(), requestRun(), acceptRevision(), retryPending(), exportArtifact(id), selectRevision(id), snapshot().
// snapshot exposes bootstrap, history, reference, activity, globalCursor, error, draft, viewedRevisionId,
// canConfirm, canRun, canAccept, canDownload. exportArtifact returns null on failure or {artifact,bytes:ArrayBuffer}.
const controllerPath = '../../src/client/workspace/live-state.js';
const root = new URL('../../', import.meta.url);
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`fixtures/api/v2/${name}.fixture.json`, root), 'utf8'));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (code: Parameters<typeof c.safeError>[0], status = 409) => json({ contractVersion: c.CONTRACT_VERSION, error: c.safeError(code) }, status);
const identity = (r: any) => Object.fromEntries(['requirementsId','requirementsVersion','registryId','registryHash','setupId','setupHash','referenceHash','validatorVersion'].map(k => [k,r[k]]));
const copy = <T>(value: T): T => structuredClone(value);

async function fakeService() {
  const current = await fixture('reviewable'), rejected = await fixture('rejected');
  let serial = 0;
  let requirements = await c.createRequirements({ designId: 'frontend_fake_demo', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 50, validatorVersion: 'frontend_fake_validator' });
  const state: any = { contractVersion: c.CONTRACT_VERSION, scopeStatus: 'selected', executionMode: 'live', unavailableReason: null,
    design: { ...current.design, designId: requirements.designId, stateVersion: 0, baselineRevisionId: 'baseline_50',
      setupHash: requirements.setupHash, activeRequirementsVersion: 1, selectedCandidateRevisionId: null, acceptedRevisionId: null, acceptedRequirementsMatch: false, activeRunId: null },
    requirements, runs: [], candidates: [] };
  const history: any = { contractVersion: c.CONTRACT_VERSION, acceptances: [], manifests: [] };
  const events: any[] = [], calls: { path: string; method: string; body: any }[] = [];
  const artifacts = new Map<string, Uint8Array>();
  const receipts = new Map<string, { body: string; value: any }>();
  const overrides = new Map<string, (() => Response | Promise<Response>)[]>();
  const referenceArtifacts = await Promise.all(['step','stl'].map(async ext => {
    const bytes = new Uint8Array(await readFile(new URL(`examples/plate/revised/plate-50x35x5.${ext}`, root)));
    const artifactId = `reference_fake_${ext}`; artifacts.set(artifactId, bytes);
    return { artifactId, fileName: `baseline.${ext}`, mediaType: `model/${ext}`, bytes: bytes.length, sha256: await c.sha256(bytes), href: `/api/reference/artifacts/${artifactId}` };
  }));
  const reference: any = { contractVersion: c.CONTRACT_VERSION, reference: { referenceId: 'plate_revised_50x35x5', revisionId: 'baseline_50', units: 'mm', provenance: 'saved_reference', artifacts: referenceArtifacts } };
  const event = (type: string, run: any = null, candidate: any = null, acceptanceId: string | null = null) => {
    events.push(c.EventSchema.parse({ contractVersion: c.CONTRACT_VERSION, eventId: events.length + 1, designId: state.design.designId,
      stateVersion: state.design.stateVersion, requirementsVersion: run?.requirementsVersion ?? state.requirements.requirementsVersion,
      units: 'mm', executionMode: 'live', createdAt: '2026-09-08T20:00:00.000Z', type,
      runId: run?.runId ?? null, revisionId: candidate?.revisionId ?? null, run: copy(run), candidate: copy(candidate), acceptanceId }));
  };
  async function completedCandidate(length: number, revisionId: string, runId: string, requestId: string, attemptId: string) {
    const template = copy((length === 30 ? rejected : current).candidates[0]);
    const candidate: any = { ...template, ...identity(state.requirements), designId: state.design.designId, revisionId, runId, requestId, attemptId,
      inputRevisionId: 'baseline_50', requirements: copy(state.requirements), executionMode: 'live',
      engine: { ...template.engine, name: 'build123d', version: 'DETERMINISTIC_FAKE_HTTP_ONLY' }, changeSummary: 'Fake HTTP evidence for frontend acceptance tests.' };
    candidate.artifacts = await Promise.all(template.artifacts.map(async (a: any, index: number) => {
      const artifactId = `${revisionId}_artifact_${index}`;
      const bytes = a.mediaType === 'model/stl' ? artifacts.get('reference_fake_stl')! : new TextEncoder().encode(`FAKE HTTP BYTES ${revisionId} ${a.kind === 'editable' ? 'source' : a.kind}`);
      artifacts.set(artifactId, bytes);
      return { ...a, ...identity(state.requirements), artifactId, designId: state.design.designId, revisionId, runId,
        href: `/api/artifacts/${artifactId}`, executionMode: 'live', bytes: bytes.length, sha256: await c.sha256(bytes) };
    }));
    candidate.geometryHash = candidate.artifacts.find((a: any) => a.mediaType === 'model/step').sha256;
    candidate.sourceSha256 = candidate.artifacts.find((a: any) => a.kind === 'source').sha256;
    candidate.checks = template.checks.map((check: any) => ({ ...check, ...identity(state.requirements), revisionId,
      geometryHash: candidate.geometryHash, executionMode: 'live', expected: c.expectedForCheck(state.requirements, check.checkId) }));
    candidate.checkBundleHash = await c.computeCheckBundleHash(candidate);
    return c.verifyCandidateEvidence(candidate);
  }
  async function complete() {
    const run = state.runs.at(-1);
    const candidate = await completedCandidate(state.requirements.setup.dimensions.lengthMm, run.candidateRevisionIds[0], run.runId, run.requestId, run.attemptIds[0]);
    state.candidates[state.candidates.findIndex((x: any) => x.revisionId === candidate.revisionId)] = candidate;
    run.status = 'completed'; run.activeAttemptId = null; state.design.activeRunId = null; state.design.selectedCandidateRevisionId = candidate.revisionId;
    event(`candidate.${candidate.status}`, run, candidate); event('run.completed', run, candidate);
  }
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://frontend.test'), path = url.pathname + url.search, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    const override = overrides.get(`${method} ${path}`)?.shift(); if (override) return override();
    if (method === 'GET') {
      if (path === '/api/reference') return json(reference);
      if (path === '/api/bootstrap') return json(c.BootstrapSchema.parse(state));
      if (path === '/api/acceptances') return json(history);
      if (url.pathname === '/api/events') return json({ contractVersion: c.CONTRACT_VERSION, events: events.filter(e => e.eventId > Number(url.searchParams.get('after'))) });
      const artifactId = path.split('/').at(-1)!;
      const descriptor = [...referenceArtifacts, ...state.candidates.flatMap((x: any) => x.artifacts)].find((a: any) => a.artifactId === artifactId);
      if (descriptor && artifacts.has(artifactId)) return new Response(artifacts.get(artifactId)!.slice(), { headers: {
        'content-type': descriptor.mediaType, 'content-length': String(descriptor.bytes),
        'x-worldkinetics-revision': descriptor.revisionId ?? 'baseline_50',
        ...(descriptor.executionMode ? { 'x-worldkinetics-execution': descriptor.executionMode } : {}),
        'x-worldkinetics-applicability': descriptor.revisionId ? (state.design.acceptedRequirementsMatch ? 'current' : 'historical') : 'saved_reference',
      } });
      return fail('INVALID_REQUEST', 404);
    }
    assert.equal(new Headers(init?.headers).get('content-type')?.split(';')[0], 'application/json');
    const prior = receipts.get(body.requestId);
    if (prior) return prior.body === c.canonicalize({ path, body }) ? json({ ...prior.value, reused: true }) : fail('IDENTITY_CONFLICT');
    let value: any;
    if (method === 'PATCH' && path === `/api/designs/${state.design.designId}/requirements`) {
      c.RequirementsUpdateRequestSchema.parse(body);
      if (body.expectedStateVersion !== state.design.stateVersion || body.expectedRequirementsVersion !== state.requirements.requirementsVersion) return fail('STATE_CONFLICT');
      requirements = await c.createRequirements({ designId: state.design.designId, requirementsVersion: state.requirements.requirementsVersion + 1,
        setupId: body.setupId, lengthMm: body.confirmedIntent.lengthMm, validatorVersion: 'frontend_fake_validator' });
      state.requirements = requirements;
      Object.assign(state.design, { activeRequirementsVersion: requirements.requirementsVersion, setupHash: requirements.setupHash,
        setupId: requirements.setupId, stateVersion: state.design.stateVersion + 1, activeRunId: null, selectedCandidateRevisionId: null, acceptedRequirementsMatch: false });
      for (const candidate of state.candidates) candidate.status = 'superseded';
      event('requirements.updated');
      value = { contractVersion: c.CONTRACT_VERSION, reused: false, design: copy(state.design), requirements: copy(requirements) };
    } else if (method === 'POST' && path === '/api/runs') {
      c.RunRequestSchema.parse(body);
      assert.equal(body.inputRevisionId, 'baseline_50'); assert.equal(body.requirementsVersion, state.requirements.requirementsVersion);
      if (state.executionMode !== 'live') return fail('TOOL_UNAVAILABLE', 503);
      const n = ++serial, runId = `fake_run_${n}`, revisionId = `fake_revision_${n}`, attemptId = `fake_attempt_${n}`;
      const run = { ...copy(current.runs[0]), ...body, ...identity(state.requirements), runId, status: 'queued', executionMode: 'live',
        attemptIds: [attemptId], candidateRevisionIds: [revisionId], activeAttemptId: attemptId, error: null };
      const candidate = { ...copy(current.candidates[0]), ...identity(state.requirements), designId: state.design.designId, revisionId, runId,
        attemptId, requestId: body.requestId, inputRevisionId: 'baseline_50', requirements: copy(state.requirements), executionMode: 'live', status: 'building',
        engine: null, sourceSha256: null, proposalHash: null, geometryHash: null, checkBundleHash: null, checks: [], artifacts: [], error: null };
      state.runs.push(run); state.candidates.push(candidate); state.design.activeRunId = runId;
      state.design.selectedCandidateRevisionId = null; state.design.stateVersion++;
      event('run.queued', run, candidate); event('candidate.building', run, candidate);
      value = { contractVersion: c.CONTRACT_VERSION, reused: false, run: copy(run) };
    } else if (method === 'POST' && path.endsWith('/accept')) {
      c.AcceptanceRequestSchema.parse(body);
      if (body.expectedStateVersion !== state.design.stateVersion || body.expectedAcceptedRevisionId !== state.design.acceptedRevisionId || body.candidateRevisionId !== state.design.selectedCandidateRevisionId) return fail('STATE_CONFLICT');
      const candidate = state.candidates.find((x: any) => x.revisionId === body.candidateRevisionId);
      if (candidate?.status !== 'reviewable') return fail('EVIDENCE_CONFLICT');
      state.design.stateVersion++; state.design.acceptedRevisionId = candidate.revisionId; state.design.acceptedRequirementsMatch = true;
      const acceptance = { contractVersion: c.CONTRACT_VERSION, acceptanceId: `fake_acceptance_${state.design.stateVersion}`, request: body,
        acceptedAt: '2026-09-08T20:00:00.000Z', stateVersion: state.design.stateVersion, candidate: copy(candidate), requirements: copy(candidate.requirements) };
      const payload = { contractVersion: c.CONTRACT_VERSION, manifestId: `fake_manifest_${state.design.stateVersion}`, acceptanceId: acceptance.acceptanceId,
        designId: candidate.designId, runId: candidate.runId, revisionId: candidate.revisionId, requirements: candidate.requirements,
        checkBundleHash: candidate.checkBundleHash, geometryHash: candidate.geometryHash, sourceSha256: candidate.sourceSha256,
        proposalHash: candidate.proposalHash, engine: candidate.engine, checks: candidate.checks, changeSummary: candidate.changeSummary, units: candidate.units, artifacts: candidate.artifacts };
      const manifest = { ...payload, manifestHash: await c.hashCanonical(payload) };
      value = await verifyAcceptanceResponse({ contractVersion: c.CONTRACT_VERSION, reused: false, acceptance, manifest }, body);
      history.acceptances.unshift(acceptance); history.manifests.push(manifest); event('revision.accepted', null, null, acceptance.acceptanceId);
      state.executionMode = 'unavailable'; state.unavailableReason = 'Numeric fake runtime stops new runs after acceptance.';
    } else if (method === 'POST' && path.endsWith('/export')) {
      c.ExportRequestSchema.parse(body);
      const acceptance = history.acceptances[0], manifest = history.manifests.find((m: any) => m.acceptanceId === acceptance?.acceptanceId);
      if (!acceptance || !state.design.acceptedRequirementsMatch || body.acceptanceId !== acceptance.acceptanceId || body.manifestId !== manifest.manifestId || body.manifestHash !== manifest.manifestHash || !path.includes(`/${acceptance.candidate.revisionId}/`)) return fail('STATE_CONFLICT');
      value = { contractVersion: c.CONTRACT_VERSION, reused: false, acceptance, manifest };
    } else return fail('INVALID_REQUEST', 404);
    receipts.set(body.requestId, { body: c.canonicalize({ path, body }), value: copy(value) });
    return json(value, path === '/api/runs' ? 202 : 200);
  };
  const { createLiveWorkspaceController } = await import(controllerPath);
  const controller = createLiveWorkspaceController({ fetch: fetcher });
  return { controller, state, history, reference, events, calls, artifacts, overrides, complete, event, fetcher };
}

async function generated(length = 36) {
  const service = await fakeService(); const { controller } = service;
  await controller.load(); controller.setDraft({ lengthMm: String(length), instruction: `Make length ${length} mm.` });
  await controller.confirmRequirements(); await controller.requestRun(); await service.complete(); await controller.refresh();
  return service;
}

test('actual reference and authoritative records load without any mutation', async () => {
  const s = await fakeService(); await s.controller.load();
  assert.ok(s.calls.every(call => call.method === 'GET'));
  assert.ok(s.calls.findIndex(x => x.path === '/api/events?after=0') < s.calls.findIndex(x => x.path === '/api/bootstrap'));
  const v = s.controller.snapshot(); assert.equal(v.reference.referenceId, 'plate_revised_50x35x5');
  assert.equal(v.bootstrap.design.baselineRevisionId, 'baseline_50'); assert.deepEqual(v.history.acceptances, []);
  assert.equal(v.canAccept, false); assert.equal(v.canDownload, false);
});

test('explicit 30 then 36 confirmation/run preserves versions, rejection and exact acceptance/download identity', async () => {
  const s = await generated(30), { controller } = s;
  assert.equal(controller.snapshot().canAccept, false); assert.equal(s.state.requirements.setup.dimensions.lengthMm, 30);
  const firstRevision = s.state.design.selectedCandidateRevisionId;
  assert.equal(s.state.candidates[0].checks.find((x: any) => x.checkId === 'margin.end_material').state, 'failed');
  const count = s.calls.length; controller.setDraft({ lengthMm: '36', instruction: 'Make length 36 mm.' });
  assert.equal(s.calls.length, count, 'Typing cannot mutate');
  await controller.confirmRequirements(); assert.equal(s.state.requirements.requirementsVersion, 3);
  await controller.requestRun(); await s.complete(); await controller.refresh();
  const currentRevision = s.state.design.selectedCandidateRevisionId;
  controller.selectRevision(firstRevision); assert.equal(controller.snapshot().canAccept, false);
  assert.equal(controller.snapshot().bootstrap.candidates[0].requirementsVersion, 2);
  controller.selectRevision(currentRevision); assert.equal(controller.snapshot().canAccept, true);
  assert.equal(s.history.acceptances.length, 0, 'Completed generation never accepts');
  await controller.acceptRevision(); assert.equal(controller.snapshot().canRun, false);
  assert.equal(controller.snapshot().canDownload, true, 'Unavailable new runs do not disable accepted export');
  const artifact = s.history.manifests[0].artifacts.find((x: any) => x.mediaType === 'model/step');
  const downloaded = await controller.exportArtifact(artifact.artifactId);
  assert.equal(downloaded.artifact.artifactId, artifact.artifactId);
  assert.equal(await c.sha256(new Uint8Array(downloaded.bytes)), artifact.sha256);
  assert.equal(downloaded.bytes.byteLength, artifact.bytes);
  const exportCall = s.calls.find(x => x.path.endsWith('/export'))!;
  assert.equal(exportCall.body.acceptanceId, s.history.acceptances[0].acceptanceId);
  assert.equal(exportCall.body.manifestHash, s.history.manifests[0].manifestHash);
});

test('authentication HTML, malformed JSON and unavailable responses retain local draft without fixtures', async () => {
  for (const response of [new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('<html>Denied</html>', { status: 403, headers: { 'content-type': 'text/html' } }),
    new Response('{bad', { headers: { 'content-type': 'application/json' } })]) {
    const s = await fakeService(); s.controller.setDraft({ lengthMm: '30', instruction: 'Keep my draft' });
    s.overrides.set('GET /api/bootstrap', [() => response]); await s.controller.load();
    const view = s.controller.snapshot(); assert.ok(view.error); assert.equal(view.canRun, false); assert.equal(view.canAccept, false); assert.equal(view.canDownload, false);
    assert.deepEqual(view.draft, { lengthMm: '30', instruction: 'Keep my draft' });
    assert.ok(s.calls.every(x => !x.path.includes('/fixtures/'))); assert.ok(!String(view.error).includes('<html>'));
  }
});

test('CAS conflict refreshes state, keeps draft and requires another deliberate confirmation', async () => {
  const s = await fakeService(); await s.controller.load(); s.controller.setDraft({ lengthMm: '30', instruction: 'Keep intent' });
  s.state.design.stateVersion++;
  await s.controller.confirmRequirements();
  assert.equal(s.calls.filter(x => x.method === 'PATCH').length, 1); assert.equal(s.calls.filter(x => x.path === '/api/runs').length, 0);
  assert.equal(s.controller.snapshot().draft.lengthMm, '30'); assert.ok(s.controller.snapshot().error);
  assert.equal(s.controller.snapshot().bootstrap.design.stateVersion, 1);
  await s.controller.confirmRequirements();
  const patches = s.calls.filter(x => x.method === 'PATCH'); assert.equal(patches.length, 2);
  assert.notEqual(patches[0].body.requestId, patches[1].body.requestId);
  assert.equal(patches[1].body.expectedStateVersion, 1);
});

test('uncertain mutation retry reuses exact request and action identity rather than silently issuing a new action', async () => {
  const s = await fakeService(); await s.controller.load(); s.controller.setDraft({ lengthMm: '30', instruction: 'Make length 30 mm' });
  s.overrides.set(`PATCH /api/designs/${s.state.design.designId}/requirements`, [() => Promise.reject(new Error('connection lost'))]);
  await s.controller.confirmRequirements(); assert.ok(s.controller.snapshot().error);
  await s.controller.retryPending();
  const patches = s.calls.filter(x => x.method === 'PATCH'); assert.equal(patches.length, 2); assert.deepEqual(patches[0].body, patches[1].body);
});

test('global cursor survives snapshot refresh and processes old-requirement and same-version observations', async () => {
  const s = await generated(30); const previous = s.controller.snapshot().globalCursor;
  s.controller.setDraft({ lengthMm: '36', instruction: 'Next' }); await s.controller.confirmRequirements();
  const oldRun = s.state.runs[0]; s.event('run.completed', oldRun, s.state.candidates[0]);
  await s.controller.refresh();
  assert.equal(s.controller.snapshot().globalCursor, s.events.at(-1).eventId);
  assert.ok(s.controller.snapshot().globalCursor > previous);
  const cursor = s.controller.snapshot().globalCursor; await s.controller.refresh(); assert.equal(s.controller.snapshot().globalCursor, cursor);
  assert.ok(s.calls.some(x => x.path === `/api/events?after=${cursor}`));
  const count = s.controller.snapshot().activity.length; await s.controller.refresh(); assert.equal(s.controller.snapshot().activity.length, count);
  await s.controller.reconnect(); assert.ok(s.calls.filter(x => x.path === '/api/events?after=0').length >= 2);
  assert.ok(!s.calls.some(x => /^\/api\/runs\/.*\/events/.test(x.path)));
});

test('a delayed earlier bootstrap cannot replace a newer confirmed snapshot', async () => {
  const s = await fakeService(); await s.controller.load(); const old = copy(s.state);
  let release!: (response: Response) => void;
  s.overrides.set('GET /api/bootstrap', [() => new Promise<Response>(resolve => { release = resolve; })]);
  const earlier = s.controller.refresh();
  for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(release); s.state.design.stateVersion = 5;
  await s.controller.refresh(); release(json(old)); await earlier;
  assert.equal(s.controller.snapshot().bootstrap.design.stateVersion, 5);
});

test('accepted A remains downloadable while inspecting B and while new execution is unavailable', async () => {
  const s = await generated(); await s.controller.acceptRevision(); const accepted = s.state.design.acceptedRevisionId;
  s.state.executionMode = 'live';
  // Fake transport-only state models accepted A versus selected B. No real runtime is mutated.
  const run = s.state.runs[0], candidate = copy(s.state.candidates[0]);
  candidate.revisionId = 'fake_unaccepted_b'; candidate.runId = 'fake_run_b'; candidate.requestId = 'fake_request_b'; candidate.attemptId = 'fake_attempt_b';
  candidate.artifacts = candidate.artifacts.map((a: any, i: number) => ({ ...a, artifactId: `fake_b_${i}`, href: `/api/artifacts/fake_b_${i}`, revisionId: candidate.revisionId, runId: candidate.runId }));
  candidate.checks = candidate.checks.map((check: any) => ({ ...check, revisionId: candidate.revisionId })); candidate.checkBundleHash = await c.computeCheckBundleHash(candidate);
  s.state.candidates.push(candidate); s.state.runs.push({ ...copy(run), runId: candidate.runId, requestId: candidate.requestId, attemptIds: [candidate.attemptId], candidateRevisionIds: [candidate.revisionId] });
  s.state.design.selectedCandidateRevisionId = candidate.revisionId; s.state.design.stateVersion++; s.state.executionMode = 'unavailable';
  await s.controller.refresh(); s.controller.selectRevision(candidate.revisionId);
  assert.equal(s.controller.snapshot().canRun, false); assert.equal(s.controller.snapshot().canDownload, true);
  const artifact = s.history.manifests[0].artifacts[0]; await s.controller.exportArtifact(artifact.artifactId);
  assert.ok(s.calls.at(-2)?.path === `/api/revisions/${accepted}/export` || s.calls.some(x => x.method === 'POST' && x.path === `/api/revisions/${accepted}/export`));
  s.state.design.acceptedRequirementsMatch = false; await s.controller.refresh(); assert.equal(s.controller.snapshot().canDownload, false);
});

test('mismatched latest history and corrupt artifact bytes cannot create a current download', async () => {
  const s = await generated(); await s.controller.acceptRevision();
  const artifact = s.history.manifests[0].artifacts[0];
  s.overrides.set(`GET ${artifact.href}`, [() => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })]);
  assert.equal(await s.controller.exportArtifact(artifact.artifactId), null);
  s.artifacts.set(artifact.artifactId, new TextEncoder().encode('tampered'));
  assert.equal(await s.controller.exportArtifact(artifact.artifactId), null);
  const newer = copy(s.history.acceptances[0]); newer.stateVersion += 10;
  s.overrides.set('GET /api/acceptances', [() => json({ ...s.history, acceptances: [newer] }), () => json({ ...s.history, acceptances: [newer] })]);
  await s.controller.refresh(); assert.equal(s.controller.snapshot().canDownload, false);
});

test('a later acceptance of the same revision uses the latest manifest joined by acceptance ID', async () => {
  const s = await generated(); await s.controller.acceptRevision();
  const old = copy(s.history.acceptances[0]), body = { ...old.request, requestId: 'fake_reaccept_request', userActionId: 'fake_reaccept_action',
    expectedStateVersion: s.state.design.stateVersion, expectedAcceptedRevisionId: old.candidate.revisionId };
  await s.fetcher(`/api/revisions/${old.candidate.revisionId}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const latest = s.history.acceptances[0]; assert.notEqual(latest.acceptanceId, old.acceptanceId);
  await s.controller.refresh(); assert.equal(s.controller.snapshot().history.acceptances.length, 2);
  const manifest = s.history.manifests.find((m: any) => m.acceptanceId === latest.acceptanceId);
  assert.ok(await s.controller.exportArtifact(manifest.artifacts[0].artifactId));
  const request = s.calls.filter(x => x.path.endsWith('/export')).at(-1)!;
  assert.equal(request.body.acceptanceId, latest.acceptanceId); assert.equal(request.body.manifestId, manifest.manifestId);
});

test('a new-run 503 retains the draft and never reports a candidate or switches to fixtures', async () => {
  const s = await fakeService(); await s.controller.load(); s.controller.setDraft({ lengthMm: '30', instruction: 'Keep request' });
  await s.controller.confirmRequirements(); s.overrides.set('POST /api/runs', [() => fail('TOOL_UNAVAILABLE', 503)]);
  await s.controller.requestRun();
  assert.ok(s.controller.snapshot().error); assert.equal(s.controller.snapshot().draft.instruction, 'Keep request');
  assert.equal(s.controller.snapshot().bootstrap.candidates.length, 0);
  assert.equal(s.controller.snapshot().canAccept, false); assert.equal(s.controller.snapshot().canDownload, false);
  assert.ok(s.calls.every(x => !x.path.includes('/fixtures/')));
});

// OUTSIDE_WRAPPER: source-review follow-up guards for HTTP artifact identity and current applicability.
test('export rejects missing/mismatched candidate headers and a requirements change reflected as historical bytes', async () => {
  for (const headers of [
    { 'x-worldkinetics-revision': 'wrong_revision', 'x-worldkinetics-execution': 'live', 'x-worldkinetics-applicability': 'current' },
    { 'x-worldkinetics-revision': null, 'x-worldkinetics-execution': 'live', 'x-worldkinetics-applicability': 'current' },
    { 'x-worldkinetics-execution': 'fixture', 'x-worldkinetics-applicability': 'current' },
    { 'x-worldkinetics-execution': null, 'x-worldkinetics-applicability': 'current' },
    { 'x-worldkinetics-execution': 'live', 'x-worldkinetics-applicability': 'historical' },
  ]) {
    const s = await generated(); await s.controller.acceptRevision();
    const artifact = s.history.manifests[0].artifacts.find((a: any) => a.mediaType === 'model/step');
    s.overrides.set(`GET ${artifact.href}`, [() => {
      const values = new Headers({ 'content-type': artifact.mediaType, 'content-length': String(artifact.bytes),
        'x-worldkinetics-revision': artifact.revisionId, 'x-worldkinetics-execution': 'live', 'x-worldkinetics-applicability': 'current' });
      for (const [key,value] of Object.entries(headers)) value === null ? values.delete(key) : values.set(key, value);
      return new Response(s.artifacts.get(artifact.artifactId)!.slice(), { headers: values });
    }]);
    assert.equal(await s.controller.exportArtifact(artifact.artifactId), null, JSON.stringify(headers));
    assert.ok(s.controller.snapshot().error);
  }
});

test('historical live candidate preview is allowed but revision/execution identity still must match', async () => {
  const s = await generated(); const revision = s.state.design.selectedCandidateRevisionId;
  const artifact = s.state.candidates[0].artifacts.find((a: any) => a.mediaType === 'model/stl');
  assert.ok(await s.controller.preview(revision), 'Unaccepted historical bytes are valid preview input');
  for (const headers of [{ 'x-worldkinetics-revision': 'different_revision' }, { 'x-worldkinetics-execution': 'fixture' }]) {
    s.overrides.set(`GET ${artifact.href}`, [() => new Response(s.artifacts.get(artifact.artifactId)!.slice(), { headers: {
      'content-type': artifact.mediaType, 'content-length': String(artifact.bytes), 'x-worldkinetics-revision': revision,
      'x-worldkinetics-execution': 'live', 'x-worldkinetics-applicability': 'historical', ...headers,
    } })]);
    assert.equal(await s.controller.preview(revision), null);
  }
  assert.ok(await s.controller.preview(null), 'Saved baseline has separate header semantics and no execution header');
});

// OUTSIDE_WRAPPER: local presentation lifecycle seam, not a transport envelope or browser-rendering claim.
// createLivePresentation() from live-presentation.ts exposes update(snapshot, 'baseline'|'candidate', active=true),
// rendered(previewKey), failed(previewKey), invalidate(). update returns previewKey (string|null),
// previewAction ('load'|'retain'|'clear'), evidenceAction ('replace'|'retain'), and canAccept.
// mountLive/main must actually use this lifecycle, with rendered called only after viewer.show succeeds.
const presentationPath = '../../src/client/workspace/live-presentation.js';
test('unchanged verified geometry and expanded evidence survive background refresh, draft input and unrelated activity', async () => {
  const s = await generated(), { createLivePresentation } = await import(presentationPath);
  const view = createLivePresentation(), initial = s.controller.snapshot();
  const first = view.update(initial, 'candidate'); assert.equal(first.previewAction, 'load'); assert.equal(first.evidenceAction, 'replace');
  assert.equal(first.canAccept, false); view.rendered(first.previewKey);
  let result = view.update(initial, 'candidate'); assert.equal(result.previewAction, 'retain'); assert.equal(result.canAccept, true);
  result = view.update({ ...initial, loading: true, trusted: false, canAccept: false }, 'candidate');
  assert.equal(result.previewAction, 'retain', 'Do not clear/refit unchanged geometry during background verification');
  assert.equal(result.evidenceAction, 'retain', 'Do not replace expanded details during background verification');
  assert.equal(result.canAccept, false);
  result = view.update({ ...initial, draft: { lengthMm: '30', instruction: 'new draft' }, globalCursor: initial.globalCursor + 1 }, 'candidate');
  assert.equal(result.previewAction, 'retain'); assert.equal(result.evidenceAction, 'retain'); assert.equal(result.canAccept, true);
});

test('acceptance requires rendered selected-candidate identity and is blocked for baseline, failure, historical view and inactive mode', async () => {
  const s = await generated(), { createLivePresentation } = await import(presentationPath);
  const view = createLivePresentation(), state = s.controller.snapshot();
  let result = view.update(state, 'baseline'); view.rendered(result.previewKey);
  assert.equal(view.update(state, 'baseline').canAccept, false);
  result = view.update(state, 'candidate'); assert.equal(result.canAccept, false);
  view.failed(result.previewKey); assert.equal(view.update(state, 'candidate').canAccept, false);
  assert.equal(view.update(state, 'candidate').previewAction, 'retain', 'A failed render does not trigger an automatic retry loop');
  view.invalidate(); result = view.update(state, 'candidate'); view.rendered(result.previewKey);
  assert.equal(view.update(state, 'candidate').canAccept, true);
  assert.equal(view.update({ ...state, canAccept: false }, 'candidate').canAccept, false);
  result = view.update(state, 'candidate', false); assert.equal(result.previewAction, 'clear'); assert.equal(result.canAccept, false);
  result = view.update(state, 'candidate', true); assert.equal(result.previewAction, 'load'); assert.equal(result.canAccept, false);
});

test('stale render completion, changed hashes, and failed verification never restore candidate acceptance', async () => {
  const s = await generated(), { createLivePresentation } = await import(presentationPath);
  const view = createLivePresentation(), state = s.controller.snapshot(), old = view.update(state, 'candidate');
  const changed = copy(state); changed.bootstrap.candidates[0].checkBundleHash = 'b'.repeat(64);
  let result = view.update(changed, 'candidate'); assert.notEqual(result.previewKey, old.previewKey); assert.equal(result.previewAction, 'load');
  view.rendered(old.previewKey); assert.equal(view.update(changed, 'candidate').canAccept, false);
  view.rendered(result.previewKey); assert.equal(view.update(changed, 'candidate').canAccept, true);
  result = view.update({ ...changed, loading: false, trusted: false, error: 'Cannot verify latest state', canAccept: false }, 'candidate');
  assert.equal(result.previewAction, 'clear'); assert.equal(result.canAccept, false);
  view.rendered(old.previewKey); assert.equal(view.update(changed, 'candidate').canAccept, false);
});

test('workspace exposes live actions while preserving explicitly labeled saved and synthetic modes', async () => {
  const html = await readFile(new URL('src/client/workspace/index.html', root), 'utf8');
  for (const id of ['saved-mode','review-mode','live-mode','live-length','live-request','live-confirm','live-run','live-accept','live-download']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /synthetic|fixture/i);
  const main = await readFile(new URL('src/client/workspace/main.ts', root), 'utf8');
  assert.match(main, /live/); assert.ok(!/api\.openai\.com|OPENAI_API_KEY|sk-[a-zA-Z0-9]/.test(main));
});
