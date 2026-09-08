import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { RunStore } from '../../src/server/store.js';
import { createApp } from '../../src/server/app.js';

// Supervisor acceptance bootstrap. Synthetic bytes prove state invariants, never CAD geometry.
const v2path = '../../src/shared/contracts-v2.js';
const directories: string[] = [];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function setup() {
  const c = await import(v2path);
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url), 'utf8'));
  const directory = await mkdtemp(path.join(tmpdir(), 'wk-state-v2-')); directories.push(directory);
  const requirements = await c.createRequirements({ designId: 'synthetic_state', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
  const design = { ...fixture.design, designId: requirements.designId, stateVersion: 0, activeRequirementsVersion: 1, referenceId: requirements.referenceId, referenceHash: requirements.referenceHash, setupId: requirements.setupId, setupHash: requirements.setupHash, acceptedRevisionId: null, acceptedRequirementsMatch: false, selectedCandidateRevisionId: null, activeRunId: null };
  const store = new (RunStore as any)(directory, design, requirements);
  return { c, fixture, directory, requirements, design, store };
}
async function candidate(ctx: Awaited<ReturnType<typeof setup>>, requestId = 'request_' + randomUUID()) {
  const { c, store, directory, fixture } = ctx;
  const design = store.getDesign(); const requirements = store.getRequirements();
  const request = { contractVersion: c.CONTRACT_VERSION, requestId, designId: design.designId, inputRevisionId: design.acceptedRevisionId ?? design.baselineRevisionId, requirementsVersion: requirements.requirementsVersion, setupId: requirements.setupId, units: 'mm', instruction: 'Synthetic state fixture, not a CAD operation.' };
  const { run } = await store.enqueueRun(request);
  assert.equal(run.candidateRevisionIds.length, 1, 'Queue allocates a distinct initial candidate');
  const draft = store.getCandidate(run.candidateRevisionIds[0]);
  const source = '# synthetic state source\n'; const step = 'synthetic STEP bytes ' + draft.revisionId;
  const proposal = { kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: requirements.setup.dimensions.lengthMm } } };
  const result = { ...draft, status: 'reviewable', executionMode: 'live', error: null, engine: { name: 'build123d', version: 'synthetic-test-double', imageDigest: 'sha256:' + '1'.repeat(64) }, sourceSha256: sha(source), proposalHash: await c.hashCanonical(proposal), geometryHash: sha(step), checks: [] as any[], artifacts: [] as any[], changeSummary: 'Synthetic evidence only' };
  const identity: Record<string, unknown> = {};
  for (const key of ['requirementsVersion', 'requirementsId', 'registryId', 'registryHash', 'setupId', 'setupHash', 'referenceHash', 'validatorVersion']) identity[key] = requirements[key];
  result.checks = requirements.requiredChecks.map((id: string) => ({ ...fixture.candidates[0].checks.find((check: any) => check.checkId === id), ...identity, revisionId: draft.revisionId, geometryHash: result.geometryHash, executionMode: 'live', state: 'passed', expected: c.expectedForCheck(requirements, id), measured: { synthetic: true }, details: 'Injected state test, no geometry measured.' }));
  result.checkBundleHash = await c.computeCheckBundleHash(result);
  await mkdir(path.join(directory, 'artifacts'), { recursive: true });
  for (const [name, kind, mediaType, body] of [['part.step', 'export', 'model/step', step], ['model.py', 'source', 'text/x-python', source], ['editable.py', 'editable', 'text/x-python', source], ['part.stl', 'preview', 'model/stl', 'synthetic STL bytes'], ['checks.json', 'checks', 'application/json', JSON.stringify(result.checks)], ['requirements.json', 'specification', 'application/json', JSON.stringify(requirements)]]) {
    const artifactId = 'artifact_' + randomUUID();
    await writeFile(path.join(directory, 'artifacts', artifactId), body);
    result.artifacts.push({ ...identity, artifactId, runId: run.runId, designId: design.designId, revisionId: draft.revisionId, units: 'mm', kind, mediaType, fileName: name, bytes: Buffer.byteLength(body), sha256: sha(body), href: '/api/artifacts/' + artifactId, executionMode: 'live' });
  }
  return { request, run, result };
}
function acceptRequest(ctx: Awaited<ReturnType<typeof setup>>, result: any, requestId = 'accept_' + randomUUID()) {
  const design = ctx.store.getDesign();
  return { contractVersion: ctx.c.CONTRACT_VERSION, requestId, designId: design.designId, candidateRevisionId: result.revisionId, requirementsVersion: result.requirementsVersion, expectedStateVersion: design.stateVersion, expectedAcceptedRevisionId: design.acceptedRevisionId, registryHash: result.registryHash, setupHash: result.setupHash, geometryHash: result.geometryHash, checkBundleHash: result.checkBundleHash, userActionId: 'synthetic_explicit_action_' + randomUUID() };
}
function updateRequest(ctx: Awaited<ReturnType<typeof setup>>, lengthMm = 40) {
  const d = ctx.store.getDesign();
  return { contractVersion: ctx.c.CONTRACT_VERSION, requestId: 'confirm_' + randomUUID(), expectedStateVersion: d.stateVersion, expectedRequirementsVersion: d.activeRequirementsVersion, setupId: 'resize_centered_v1', confirmedIntent: { lengthMm }, userActionId: 'synthetic_confirmation_' + randomUUID() };
}

test('completion does not accept; exact explicit acceptance retries once across restart', async () => {
  const ctx = await setup(); const { result } = await candidate(ctx);
  await ctx.store.completeCandidate(result);
  assert.equal(ctx.store.getDesign().acceptedRevisionId, null);
  assert.equal(ctx.store.getCandidate(result.revisionId).status, 'reviewable');
  const request = acceptRequest(ctx, result); const first = await ctx.store.acceptRevision(request);
  assert.equal(ctx.store.getDesign().acceptedRevisionId, result.revisionId);
  assert.equal(ctx.store.getDesign().acceptedRequirementsMatch, true);
  assert.equal((await ctx.store.acceptRevision(request)).acceptance.acceptanceId, first.acceptance.acceptanceId);
  const restarted = new (RunStore as any)(ctx.directory, ctx.design, ctx.requirements);
  assert.equal((await restarted.acceptRevision(request)).acceptance.acceptanceId, first.acceptance.acceptanceId);
  await assert.rejects(async () => restarted.acceptRevision({ ...request, userActionId: 'changed_action' }));
});

test('missing, duplicate, unknown, failed, unevaluated and wrongly bound checks cannot be accepted', async () => {
  const mutations: Record<string, (result: any) => void> = {
    empty: r => { r.checks = []; }, missing: r => r.checks.pop(),
    duplicate: r => { r.checks[1] = structuredClone(r.checks[0]); },
    unknown: r => { r.checks[0].checkId = 'unknown.check'; },
    failed: r => { r.checks[0].state = 'failed'; r.status = 'rejected'; },
    unevaluated: r => { r.checks[0].state = 'not_evaluated'; r.status = 'rejected'; },
    geometry: r => { r.checks[0].geometryHash = '2'.repeat(64); },
    reference: r => { r.checks[0].referenceHash = '2'.repeat(64); },
    setup: r => { r.checks[0].setupHash = '2'.repeat(64); },
    validator: r => { r.checks[0].validatorVersion = 'wrong_validator'; },
    version: r => { r.checks[0].requirementsVersion++; },
    threshold: r => { r.checks.find((c: any) => c.checkId === 'margin.end_material').expected.minimumEndMaterialMm = 0; },
    fixture: r => { r.checks[0].executionMode = 'fixture'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const ctx = await setup(); const { result } = await candidate(ctx); mutate(result);
    try { result.checkBundleHash = await ctx.c.computeCheckBundleHash(result); } catch { /* Malformed identity may not be hashable. */ }
    try { await ctx.store.completeCandidate(result); } catch { /* Invalid tool evidence may fail before acceptance. */ }
    await assert.rejects(async () => ctx.store.acceptRevision(acceptRequest(ctx, result)), name);
    assert.equal(ctx.store.getDesign().acceptedRevisionId, null, name);
    if (name === 'failed' || name === 'unevaluated') assert.equal(ctx.store.getCandidate(result.revisionId).status, 'rejected', name);
  }
});

test('registered bytes must still match at acceptance', async () => {
  const ctx = await setup(); const { result } = await candidate(ctx); await ctx.store.completeCandidate(result);
  const geometry = result.artifacts.find((a: any) => a.fileName === 'part.step');
  await writeFile(path.join(ctx.directory, 'artifacts', geometry.artifactId), 'tampered geometry');
  await assert.rejects(async () => ctx.store.acceptRevision(acceptRequest(ctx, result)));
  assert.equal(ctx.store.getDesign().acceptedRevisionId, null);
});

test('a later failed candidate preserves the last explicitly accepted revision', async () => {
  const ctx = await setup(); const first = await candidate(ctx); await ctx.store.completeCandidate(first.result);
  await ctx.store.acceptRevision(acceptRequest(ctx, first.result));
  const later = await candidate(ctx); later.result.status = 'rejected'; later.result.checks[0].state = 'failed';
  later.result.checkBundleHash = await ctx.c.computeCheckBundleHash(later.result);
  await ctx.store.completeCandidate(later.result);
  await assert.rejects(async () => ctx.store.acceptRevision(acceptRequest(ctx, later.result)));
  assert.equal(ctx.store.getDesign().acceptedRevisionId, first.result.revisionId);
  assert.equal(ctx.store.getDesign().acceptedRequirementsMatch, true);
});

test('both acceptance/update race orders serialize and preserve accepted history', async () => {
  for (const acceptFirst of [true, false]) {
    const ctx = await setup(); const { result } = await candidate(ctx); await ctx.store.completeCandidate(result);
    const accept = acceptRequest(ctx, result); const update = updateRequest(ctx);
    const calls = acceptFirst ? [() => ctx.store.acceptRevision(accept), () => ctx.store.updateRequirements(update)] : [() => ctx.store.updateRequirements(update), () => ctx.store.acceptRevision(accept)];
    const outcomes = await Promise.allSettled(calls.map(call => call()));
    assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
    if (acceptFirst) {
      assert.equal(ctx.store.getDesign().acceptedRevisionId, result.revisionId);
      await ctx.store.updateRequirements(updateRequest(ctx));
      assert.equal(ctx.store.getDesign().acceptedRevisionId, result.revisionId);
      assert.equal(ctx.store.getDesign().acceptedRequirementsMatch, false);
    } else assert.equal(ctx.store.getDesign().acceptedRevisionId, null);
    assert.equal(ctx.store.getDesign().activeRequirementsVersion, 2);
    await assert.rejects(async () => ctx.store.acceptRevision({ ...accept, requestId: 'stale_accept' }));
  }
});

test('late completion cannot become selected evidence after requirements update', async () => {
  const ctx = await setup(); const { result } = await candidate(ctx);
  await ctx.store.updateRequirements(updateRequest(ctx));
  try { await ctx.store.completeCandidate(result); } catch { /* Fail-closed late completion is also permitted. */ }
  const d = ctx.store.getDesign();
  assert.equal(d.activeRequirementsVersion, 2); assert.equal(d.selectedCandidateRevisionId, null); assert.equal(d.acceptedRevisionId, null);
  assert.equal(ctx.store.getCandidate(result.revisionId).status, 'superseded');
});

test('run retries preserve identity and restart fails pending work without creating acceptance', async () => {
  const ctx = await setup(); const { request, run } = await candidate(ctx);
  assert.equal((await ctx.store.enqueueRun(request)).run.runId, run.runId);
  await assert.rejects(async () => ctx.store.enqueueRun({ ...request, instruction: 'different payload' }));
  const restarted = new (RunStore as any)(ctx.directory, ctx.design, ctx.requirements);
  assert.equal((await restarted.enqueueRun(request)).run.runId, run.runId);
  assert.equal(restarted.getRun(run.runId).status, 'failed'); assert.equal(restarted.getDesign().acceptedRevisionId, null);
});

test('legacy snapshots are preserved and cannot invent human acceptance', async () => {
  const ctx = await setup(); const original = JSON.stringify({ storageVersion: 1, design: { designId: 'legacy', label: 'Legacy', currentRevisionId: 'legacy_auto_promoted', latestRunId: null, units: 'mm' }, runs: [], requests: [], events: [] });
  await writeFile(path.join(ctx.directory, 'state.json'), original);
  assert.throws(() => new (RunStore as any)(ctx.directory, ctx.design, ctx.requirements));
  assert.equal(await readFile(path.join(ctx.directory, 'state.json'), 'utf8'), original);
});

test('actual HTTP acceptance and requirements routes enforce CAS and expose v0.2 state', async () => {
  const ctx = await setup(); const { result } = await candidate(ctx); await ctx.store.completeCandidate(result);
  const server = (createApp as any)(ctx.store, ctx.directory, null);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  const send = (url: string, method: string, body: unknown) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const request = acceptRequest(ctx, result); const accepted = await send('/api/revisions/' + result.revisionId + '/accept', 'POST', request);
    assert.ok([200, 201].includes(accepted.status));
    const stale = await send('/api/revisions/' + result.revisionId + '/accept', 'POST', { ...request, requestId: 'stale_other_request' }); assert.equal(stale.status, 409);
    const update = await send('/api/designs/' + ctx.design.designId + '/requirements', 'PATCH', updateRequest(ctx)); assert.equal(update.status, 200);
    const state = await (await fetch(base + '/api/bootstrap')).json(); assert.equal(state.contractVersion, 'wk-prototype-0.2'); assert.equal(state.design.acceptedRequirementsMatch, false);
    const ambiguous = await fetch(base + '/api/designs/' + ctx.design.designId + '/requirements', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"requestId":"a","requestId":"b"}' }); assert.equal(ambiguous.status, 400);
  } finally { await new Promise<void>(resolve => server.close(resolve)); }
});


test('acceptance history can be recovered through HTTP after a reload', async () => {
  const ctx = await setup();
  const { result } = await candidate(ctx);
  await ctx.store.completeCandidate(result);
  const accepted = await ctx.store.acceptRevision(acceptRequest(ctx, result));
  const restarted = new (RunStore as any)(ctx.directory, ctx.design, ctx.requirements);
  const server = createApp(restarted, ctx.directory, null);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/acceptances`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    const responseSchemas = await import('../../src/shared/state-v2.js') as any;
    assert.deepEqual(responseSchemas.AcceptanceHistorySchema.parse(body), body);
    assert.equal(body.contractVersion, ctx.c.CONTRACT_VERSION);
    assert.deepEqual(body.acceptances, [accepted.acceptance]);
    assert.deepEqual(body.manifests, [accepted.manifest]);
    assert.equal(body.manifests[0].acceptanceId, body.acceptances[0].acceptanceId);
    assert.equal(JSON.stringify(body).includes(ctx.directory), false);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('completed evidence requires geometry, source, editable and mesh artifacts', async () => {
  for (const omitted of ['all', 'step', 'source', 'editable', 'stl']) {
    const ctx = await setup(); const { result } = await candidate(ctx);
    result.artifacts = result.artifacts.filter((a: any) => omitted !== 'all'
      && !(omitted === 'step' && a.mediaType === 'model/step')
      && !(omitted === 'source' && a.kind === 'source')
      && !(omitted === 'editable' && a.kind === 'editable')
      && !(omitted === 'stl' && a.mediaType === 'model/stl'));
    await assert.rejects(async () => ctx.store.completeCandidate(result), omitted);
    assert.equal(ctx.store.getDesign().acceptedRevisionId, null);
  }
});
