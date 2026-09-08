import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunStore, StoreError } from '../../src/server/store.ts';
import { ArtifactStore } from '../../src/server/artifacts.ts';
import { createApp } from '../../src/server/app.ts';
import {
  CONTRACT_VERSION, BootstrapSchema, CandidateSchema, EventSchema, RunSchema,
  AcceptanceSchema, ManifestSchema, AcceptanceRequestSchema, ExportRequestSchema,
  RequirementsUpdateRequestSchema, RunRequestSchema, canonicalize, checkDefinition,
  computeCheckBundleHash, createRequirements, expectedForCheck, safeError,
  verifyCandidateEvidence,
} from '../../src/shared/contracts.ts';
import { AcceptanceHistorySchema } from '../../src/shared/state-v2.ts';

// Injected generation boundary: every file and measured field below is SYNTHETIC / NO CAD.
// The contract's live enum exercises store eligibility, not a real provider or CAD engine.
const uid = prefix => `${prefix}_${randomUUID()}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = r => Object.fromEntries([
  'requirementsVersion', 'requirementsId', 'registryId', 'registryHash',
  'setupId', 'setupHash', 'referenceHash', 'validatorVersion',
].map(key => [key, r[key]]));

async function session(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wk-demo-synthetic-no-cad-'));
  const requirements = await createRequirements({ designId: uid('synthetic'),
    requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
  const design = { designId: requirements.designId, label: 'SYNTHETIC software session / NO CAD',
    units: 'mm', stateVersion: 0, referenceId: requirements.referenceId,
    referenceHash: requirements.referenceHash, setupId: requirements.setupId,
    setupHash: requirements.setupHash, baselineRevisionId: uid('synthetic_baseline'),
    activeRequirementsVersion: 1, acceptedRevisionId: null, acceptedRequirementsMatch: false,
    selectedCandidateRevisionId: null, activeRunId: null };
  const ctx = { directory, design, requirements, server: null,
    store: new RunStore(directory, design, requirements) };
  t.after(async () => {
    await close(ctx);
    await rm(directory, { recursive: true, force: true });
  });
  await listen(ctx);
  const health = await get(ctx, '/api/health');
  assert.equal(health.executionMode, 'unavailable');
  assert.deepEqual((await bootstrap(ctx)).design, design);
  assert.deepEqual(await history(ctx), { contractVersion: CONTRACT_VERSION, acceptances: [], manifests: [] });
  return ctx;
}
async function listen(ctx) {
  ctx.server = createApp(ctx.store, ctx.directory);
  await new Promise((resolve, reject) => {
    ctx.server.once('error', reject);
    ctx.server.listen(0, '127.0.0.1', resolve);
  });
  const { port, address } = ctx.server.address();
  assert.equal(address, '127.0.0.1');
  assert.ok(![4310, 4311, 4313, 4317].includes(port));
  ctx.base = `http://127.0.0.1:${port}`;
}
async function close(ctx) {
  if (!ctx.server) return;
  ctx.server.closeAllConnections();
  await new Promise((resolve, reject) => ctx.server.close(error => error ? reject(error) : resolve()));
  ctx.server = null;
}
async function restart(ctx) {
  await close(ctx);
  ctx.store = new RunStore(ctx.directory, ctx.design, ctx.requirements);
  await listen(ctx);
}
const send = (ctx, route, body, method = 'POST') => fetch(ctx.base + route, {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function jsonOK(response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return response.json();
}
const get = async (ctx, route) => jsonOK(await fetch(ctx.base + route));
const bootstrap = async ctx => BootstrapSchema.parse(await get(ctx, '/api/bootstrap'));
const history = async ctx => AcceptanceHistorySchema.parse(await get(ctx, '/api/acceptances'));
async function httpError(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { contractVersion: CONTRACT_VERSION, error: safeError(code) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
const runRequest = ctx => {
  const d = ctx.store.getDesign();
  return RunRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: uid('synthetic_run'),
    designId: d.designId, inputRevisionId: d.acceptedRevisionId ?? d.baselineRevisionId,
    requirementsVersion: d.activeRequirementsVersion, setupId: d.setupId, units: 'mm',
    instruction: 'SYNTHETIC software evidence only. NO CAD or provider execution.' });
};

async function prepare(ctx, { failedCheck, checkState } = {}) {
  const request = runRequest(ctx);
  const { run } = await ctx.store.enqueueRun(request);
  const draft = ctx.store.getCandidate(run.candidateRevisionIds[0]);
  const r = draft.requirements;
  const source = Buffer.from(`# SYNTHETIC / NO CAD / never executed: ${draft.revisionId}\n`);
  const step = Buffer.from(`SYNTHETIC / NO CAD / not a STEP file: ${draft.revisionId}\n`);
  const result = { ...draft, status: failedCheck ? 'rejected' : 'reviewable',
    changeSummary: 'SYNTHETIC state evidence. No geometry generated or measured.',
    engine: { name: 'build123d', version: 'synthetic-test-double-no-cad', imageDigest: `sha256:${sha('NO CAD image exists')}` },
    sourceSha256: sha(source), geometryHash: sha(step),
    proposalHash: sha(canonicalize({ kind: 'numeric_operation', operation: {
      name: 'resize_plate', parameters: { lengthMm: r.setup.dimensions.lengthMm },
    } })), checks: [], artifacts: [] };
  result.checks = r.requiredChecks.map(checkId => ({
    ...identity(r), ...checkDefinition(checkId), checkId, revisionId: draft.revisionId,
    geometryHash: result.geometryHash, executionMode: 'live',
    label: `SYNTHETIC ${checkId}`, state: checkId === failedCheck ? checkState : 'passed',
    expected: expectedForCheck(r, checkId),
    measured: checkId === failedCheck && checkState === 'not_evaluated' ? null : { synthetic: true, noCad: true },
    details: 'Injected test-double measurement. No geometry measured.',
  }));
  assert.equal(result.checks.length, 7);
  result.checkBundleHash = await computeCheckBundleHash(result);
  const output = path.join(ctx.directory, uid('synthetic_bytes'));
  await mkdir(output);
  const bytesByName = new Map([
    ['synthetic.step', ['export', 'model/step', step]],
    ['synthetic-source.py', ['source', 'text/x-python', source]],
    ['synthetic-editable.py', ['editable', 'text/x-python', source]],
    ['synthetic.stl', ['preview', 'model/stl', Buffer.from(`SYNTHETIC / NO CAD / not STL: ${draft.revisionId}`)]],
    ['synthetic-checks.json', ['checks', 'application/json', Buffer.from(JSON.stringify(result.checks))]],
    ['synthetic-requirements.json', ['specification', 'application/json', Buffer.from(JSON.stringify(r))]],
  ]);
  const files = [];
  for (const [fileName, [kind, mediaType, bytes]] of bytesByName) {
    await writeFile(path.join(output, fileName), bytes);
    files.push({ path: fileName, fileName, kind, mediaType, bytes: bytes.length, sha256: sha(bytes), executionMode: 'live' });
  }
  result.artifacts = await new ArtifactStore(path.join(ctx.directory, 'artifacts')).import(result, output, files);
  const bytes = new Map(result.artifacts.map(a => [a.artifactId, bytesByName.get(a.fileName)[2]]));
  await verifyCandidateEvidence(result);
  return { request, run, result, bytes };
}
async function ready(ctx, options) {
  const item = await prepare(ctx, options);
  await ctx.store.planning(item.run.runId);
  await ctx.store.running(item.run.runId);
  await ctx.store.checking(item.run.runId);
  await ctx.store.completeCandidate(item.result);
  return item;
}
function acceptRequest(ctx, candidate) {
  const d = ctx.store.getDesign();
  return AcceptanceRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: uid('accept'),
    designId: d.designId, candidateRevisionId: candidate.revisionId, requirementsVersion: candidate.requirementsVersion,
    expectedStateVersion: d.stateVersion, expectedAcceptedRevisionId: d.acceptedRevisionId,
    registryHash: candidate.registryHash, setupHash: candidate.setupHash, geometryHash: candidate.geometryHash,
    checkBundleHash: candidate.checkBundleHash, userActionId: uid('synthetic_user_action') });
}
const acceptRoute = c => `/api/revisions/${c.revisionId}/accept`;
async function accept(ctx, item, request = acceptRequest(ctx, item.result)) {
  const body = await jsonOK(await send(ctx, acceptRoute(item.result), request));
  AcceptanceSchema.parse(body.acceptance);
  ManifestSchema.parse(body.manifest);
  assert.equal(body.contractVersion, CONTRACT_VERSION);
  assert.equal(body.acceptance.request.requestId, request.requestId);
  return body;
}
function updateRequest(ctx, lengthMm = 40) {
  const d = ctx.store.getDesign();
  return RequirementsUpdateRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: uid('confirm'),
    expectedStateVersion: d.stateVersion, expectedRequirementsVersion: d.activeRequirementsVersion,
    setupId: 'resize_centered_v1', confirmedIntent: { lengthMm }, userActionId: uid('synthetic_confirmation') });
}
const updateRoute = ctx => `/api/designs/${ctx.design.designId}/requirements`;
const update = async (ctx, request = updateRequest(ctx)) => jsonOK(await send(ctx, updateRoute(ctx), request, 'PATCH'));
const exportRoute = receipt => `/api/revisions/${receipt.manifest.revisionId}/export`;
const exportRequest = receipt => ExportRequestSchema.parse({ contractVersion: CONTRACT_VERSION,
  requestId: uid('export'), acceptanceId: receipt.acceptance.acceptanceId,
  manifestId: receipt.manifest.manifestId, manifestHash: receipt.manifest.manifestHash });
async function download(ctx, artifact, bytes, applicability) {
  const response = await fetch(ctx.base + artifact.href);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), artifact.mediaType);
  assert.equal(response.headers.get('content-length'), String(artifact.bytes));
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="${artifact.fileName}"`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-worldkinetics-applicability'), applicability);
  assert.equal(response.headers.get('x-worldkinetics-revision'), artifact.revisionId);
  assert.equal(response.headers.get('x-worldkinetics-execution'), 'live');
  const actual = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(actual, bytes);
  assert.equal(actual.length, artifact.bytes);
  assert.equal(sha(actual), artifact.sha256);
}

test('[HTTP_FLOW] explicit acceptance joins manifest and exact synthetic HTTP downloads', async t => {
  const ctx = await session(t);
  const item = await ready(ctx);
  const candidate = CandidateSchema.parse(await get(ctx, `/api/candidates/${item.result.revisionId}`));
  assert.deepEqual(candidate.artifacts, item.result.artifacts);
  assert.equal(candidate.checkBundleHash, await computeCheckBundleHash(candidate));
  const request = acceptRequest(ctx, candidate);
  const receipt = await accept(ctx, item, request);
  assert.equal(receipt.reused, false);
  assert.deepEqual(receipt.acceptance.request, request);
  assert.equal(receipt.acceptance.stateVersion, request.expectedStateVersion + 1);
  const manifest = await get(ctx, `/api/manifests/${receipt.manifest.manifestId}`);
  assert.deepEqual(manifest, receipt.manifest);
  const { manifestHash, ...payload } = manifest;
  assert.equal(manifestHash, sha(canonicalize(payload)));
  assert.equal(manifest.acceptanceId, receipt.acceptance.acceptanceId);
  assert.equal(manifest.revisionId, candidate.revisionId);
  assert.deepEqual(manifest.requirements, candidate.requirements);
  assert.deepEqual(manifest.checks, candidate.checks);
  for (const key of ['geometryHash', 'checkBundleHash', 'sourceSha256', 'proposalHash']) assert.equal(manifest[key], candidate[key]);
  assert.deepEqual(manifest.artifacts, candidate.artifacts);
  const exported = await jsonOK(await send(ctx, exportRoute(receipt), exportRequest(receipt)));
  assert.deepEqual(exported, { ...receipt, reused: false });
  for (const artifact of manifest.artifacts) await download(ctx, artifact, item.bytes.get(artifact.artifactId), 'current');
  assert.equal((await bootstrap(ctx)).design.acceptedRevisionId, candidate.revisionId);
  assert.equal(JSON.stringify(receipt).includes(ctx.directory), false);
});

test('[NO_AUTO_ACCEPT] completion selects evidence without accepting it', async t => {
  const ctx = await session(t);
  const item = await ready(ctx);
  const state = await bootstrap(ctx);
  assert.equal(state.runs[0].status, 'completed');
  assert.equal(state.candidates[0].status, 'reviewable');
  assert.equal(state.design.selectedCandidateRevisionId, item.result.revisionId);
  assert.equal(state.design.acceptedRevisionId, null);
  assert.equal(state.design.acceptedRequirementsMatch, false);
  assert.equal(state.design.activeRunId, null);
  assert.deepEqual((await history(ctx)).acceptances, []);
  assert.equal(ctx.store.getEvents().some(e => e.type === 'revision.accepted'), false);
  const receipt = await accept(ctx, item);
  const later = await ready(ctx);
  assert.equal((await bootstrap(ctx)).design.acceptedRevisionId, item.result.revisionId);
  assert.equal(ctx.store.getDesign().selectedCandidateRevisionId, later.result.revisionId);
  assert.deepEqual((await history(ctx)).acceptances, [receipt.acceptance]);
});

test('[ACCEPT_SELECTION] old reviewable evidence cannot replace the selected candidate', async t => {
  const ctx = await session(t);
  const old = await ready(ctx);
  const selected = await ready(ctx);
  assert.equal(ctx.store.getCandidate(old.result.revisionId).status, 'reviewable');
  assert.equal((await bootstrap(ctx)).design.selectedCandidateRevisionId, selected.result.revisionId);
  const before = ctx.store.getDesign();
  await httpError(await send(ctx, acceptRoute(old.result), acceptRequest(ctx, old.result)), 409, 'STATE_CONFLICT');
  assert.deepEqual(ctx.store.getDesign(), before);
  assert.deepEqual((await history(ctx)).acceptances, []);
  assert.equal((await accept(ctx, selected)).acceptance.candidate.revisionId, selected.result.revisionId);
});

test('[ACCEPT_STATE_CAS] stale versions and simultaneous conflicting actions cannot both commit', async t => {
  const ctx = await session(t);
  const item = await ready(ctx);
  const stale = { ...acceptRequest(ctx, item.result), expectedStateVersion: ctx.store.getDesign().stateVersion - 1 };
  await httpError(await send(ctx, acceptRoute(item.result), stale), 409, 'STATE_CONFLICT');
  assert.equal(ctx.store.getDesign().acceptedRevisionId, null);
  const requests = [acceptRequest(ctx, item.result), acceptRequest(ctx, item.result)];
  const replies = await Promise.all(requests.map(r => send(ctx, acceptRoute(item.result), r)));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  for (const reply of replies) {
    if (reply.status === 200) await jsonOK(reply);
    else await httpError(reply, 409, 'STATE_CONFLICT');
  }
  assert.equal((await history(ctx)).acceptances.length, 1);
  assert.equal(ctx.store.getDesign().stateVersion, requests[0].expectedStateVersion + 1);
  const wrongPrior = { ...acceptRequest(ctx, item.result), expectedAcceptedRevisionId: null };
  await httpError(await send(ctx, acceptRoute(item.result), wrongPrior), 409, 'STATE_CONFLICT');
});

test('[REQUIREMENTS_CAS] confirmed versions and both action race orders preserve history', async t => {
  const ctx = await session(t);
  await update(ctx);
  const current = updateRequest(ctx, 44);
  for (const changed of [
    { ...current, expectedStateVersion: current.expectedStateVersion - 1 },
    { ...current, expectedRequirementsVersion: current.expectedRequirementsVersion - 1 },
  ]) await httpError(await send(ctx, updateRoute(ctx), changed, 'PATCH'), 409, 'STATE_CONFLICT');
  const race = [updateRequest(ctx, 44), updateRequest(ctx, 48)];
  const responses = await Promise.all(race.map(r => send(ctx, updateRoute(ctx), r, 'PATCH')));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const winner = responses.findIndex(r => r.status === 200);
  await jsonOK(responses[winner]);
  await httpError(responses[1 - winner], 409, 'STATE_CONFLICT');
  assert.equal(ctx.store.getRequirements().requirementsVersion, 3);
  assert.equal(ctx.store.getRequirements().setup.dimensions.lengthMm, race[winner].confirmedIntent.lengthMm);
  // Direct public store calls reserve both orders synchronously before either awaits.
  for (const acceptanceFirst of [true, false]) {
    const ordered = await session(t);
    const item = await ready(ordered);
    const a = acceptRequest(ordered, item.result);
    const u = updateRequest(ordered);
    const calls = acceptanceFirst
      ? [() => ordered.store.acceptRevision(a), () => ordered.store.updateRequirements(u)]
      : [() => ordered.store.updateRequirements(u), () => ordered.store.acceptRevision(a)];
    const outcomes = await Promise.allSettled(calls.map(call => call()));
    assert.equal(outcomes[0].status, 'fulfilled');
    assert.equal(outcomes[1].status, 'rejected');
    assert.ok(outcomes[1].reason instanceof StoreError);
    assert.equal(outcomes[1].reason.status, 409);
    assert.equal(outcomes[1].reason.code, 'STATE_CONFLICT');
    if (acceptanceFirst) await update(ordered);
    const state = await bootstrap(ordered);
    assert.equal(state.design.activeRequirementsVersion, 2);
    assert.equal(state.design.acceptedRevisionId, acceptanceFirst ? item.result.revisionId : null);
    assert.equal(state.design.acceptedRequirementsMatch, false);
    assert.equal((await history(ordered)).acceptances.length, acceptanceFirst ? 1 : 0);
  }
  const httpRace = await session(t);
  const item = await ready(httpRace);
  const replies = await Promise.all([
    send(httpRace, acceptRoute(item.result), acceptRequest(httpRace, item.result)),
    send(httpRace, updateRoute(httpRace), updateRequest(httpRace), 'PATCH'),
  ]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  for (const reply of replies) {
    if (reply.status === 200) await jsonOK(reply);
    else await httpError(reply, 409, 'STATE_CONFLICT');
  }
});

test('[IDEMPOTENT_PAYLOAD] canonical retries preserve identities and never roll later state back', async t => {
  const ctx = await session(t);
  const item = await ready(ctx);
  const reorder = obj => Object.fromEntries(Object.entries(obj).reverse().map(([k, v]) =>
    [k, v && typeof v === 'object' && !Array.isArray(v) ? reorder(v) : v]));
  const runRetry = await jsonOK(await send(ctx, '/api/runs', reorder(item.request)));
  assert.equal(runRetry.reused, true);
  assert.equal(runRetry.run.runId, item.run.runId);
  await httpError(await send(ctx, '/api/runs', { ...item.request, instruction: 'Changed synthetic intent' }), 409, 'IDENTITY_CONFLICT');
  const a = acceptRequest(ctx, item.result);
  const accepted = await accept(ctx, item, a);
  assert.deepEqual(await accept(ctx, item, reorder(a)), { ...accepted, reused: true });
  await httpError(await send(ctx, acceptRoute(item.result), { ...a, userActionId: uid('different') }), 409, 'IDENTITY_CONFLICT');
  const u = updateRequest(ctx);
  const updated = await update(ctx, u);
  assert.deepEqual(await update(ctx, reorder(u)), { ...updated, reused: true });
  await httpError(await send(ctx, updateRoute(ctx), { ...u, confirmedIntent: { lengthMm: 44 } }, 'PATCH'), 409, 'IDENTITY_CONFLICT');
  await httpError(await send(ctx, updateRoute(ctx), { ...updateRequest(ctx), requestId: a.requestId }, 'PATCH'), 409, 'IDENTITY_CONFLICT');
  const later = await ready(ctx);
  const newest = await accept(ctx, later);
  const before = await bootstrap(ctx);
  const events = ctx.store.getEvents();
  await restart(ctx);
  assert.deepEqual(await accept(ctx, item, a), { ...accepted, reused: true });
  assert.deepEqual(await update(ctx, u), { ...updated, reused: true });
  const oldRun = await jsonOK(await send(ctx, '/api/runs', item.request));
  assert.equal(oldRun.run.runId, item.run.runId);
  assert.equal(oldRun.reused, true);
  assert.deepEqual(await bootstrap(ctx), before);
  assert.deepEqual(ctx.store.getEvents(), events);
  assert.equal((await history(ctx)).acceptances[0].acceptanceId, newest.acceptance.acceptanceId);
  const e = exportRequest(newest);
  const firstExport = await jsonOK(await send(ctx, exportRoute(newest), e));
  assert.deepEqual(await jsonOK(await send(ctx, exportRoute(newest), reorder(e))), { ...firstExport, reused: true });
  await httpError(await send(ctx, exportRoute(newest), { ...e, manifestHash: sha('different manifest') }), 409, 'IDENTITY_CONFLICT');
  await httpError(await send(ctx, exportRoute(newest), { ...exportRequest(newest), requestId: item.request.requestId }), 409, 'IDENTITY_CONFLICT');
});

test('[HISTORY_RELOAD] newest-first HTTP history and exact manifest joins survive restart', async t => {
  const ctx = await session(t);
  const first = await accept(ctx, await ready(ctx));
  await update(ctx);
  const second = await accept(ctx, await ready(ctx));
  const expected = { contractVersion: CONTRACT_VERSION,
    acceptances: [second.acceptance, first.acceptance], manifests: [second.manifest, first.manifest] };
  assert.deepEqual(await history(ctx), expected);
  await restart(ctx);
  assert.deepEqual(await history(ctx), expected);
  assert.deepEqual(ctx.store.listAcceptances(), expected.acceptances);
  assert.deepEqual(ctx.store.listManifests(), expected.manifests);
  for (const receipt of [first, second]) {
    assert.deepEqual(await get(ctx, `/api/acceptances/${receipt.acceptance.acceptanceId}`), receipt.acceptance);
    assert.deepEqual(await get(ctx, `/api/manifests/${receipt.manifest.manifestId}`), receipt.manifest);
    assert.equal(receipt.manifest.acceptanceId, receipt.acceptance.acceptanceId);
    assert.deepEqual(receipt.manifest.artifacts, receipt.acceptance.candidate.artifacts);
  }
});

test('[HISTORY_CLONE] nested changes to returned history never mutate persisted state', async t => {
  const ctx = await session(t);
  const receipt = await accept(ctx, await ready(ctx));
  const original = await history(ctx);
  const acceptances = ctx.store.listAcceptances();
  const manifests = ctx.store.listManifests();
  acceptances[0].candidate.checks[0].measured = { poisoned: true };
  acceptances[0].requirements.setup.dimensions.lengthMm = 999;
  manifests[0].artifacts[0].fileName = 'poisoned.step';
  manifests[0].checks[0].details = 'poisoned';
  assert.deepEqual(ctx.store.listAcceptances(), original.acceptances);
  assert.deepEqual(ctx.store.listManifests(), original.manifests);
  ctx.store.getAcceptance(receipt.acceptance.acceptanceId).candidate.artifacts.splice(0);
  ctx.store.getManifest(receipt.manifest.manifestId).requirements.setup.dimensions.lengthMm = 998;
  assert.deepEqual(await history(ctx), original);
  await restart(ctx);
  assert.deepEqual(await history(ctx), original);
});

test('[EVENT_CURSOR] strict monotonic cursors deduplicate polling and survive restart', async t => {
  const ctx = await session(t);
  const item = await ready(ctx);
  const first = (await get(ctx, '/api/events')).events.map(e => EventSchema.parse(e));
  assert.ok(first.length >= 6);
  assert.deepEqual(first.map(e => e.eventId), first.map((_, i) => i + 1));
  const cursor = first.at(-1).eventId;
  assert.deepEqual((await get(ctx, `/api/events?after=${cursor}`)).events, []);
  assert.deepEqual((await get(ctx, `/api/runs/${item.run.runId}/events?after=${cursor}`)).events, []);
  assert.deepEqual(ctx.store.getEvents(undefined, cursor), []);
  const receipt = await accept(ctx, item);
  const tail = (await get(ctx, `/api/events?after=${cursor}`)).events;
  assert.deepEqual(tail.map(e => e.type), ['revision.accepted']);
  assert.equal(tail[0].acceptanceId, receipt.acceptance.acceptanceId);
  assert.equal(tail[0].eventId, cursor + 1);
  await restart(ctx);
  assert.deepEqual((await get(ctx, `/api/events?after=${cursor}`)).events, tail);
  await update(ctx);
  const all = (await get(ctx, '/api/events')).events;
  const next = (await get(ctx, `/api/events?after=${tail[0].eventId}`)).events;
  assert.deepEqual([...first, ...tail, ...next], all);
  assert.equal(new Set(all.map(e => e.eventId)).size, all.length);
  assert.ok(all.every((e, i) => i === 0 || e.stateVersion >= all[i - 1].stateVersion));
  assert.deepEqual((await get(ctx, `/api/runs/${item.run.runId}/events`)).events, all.filter(e => e.runId === item.run.runId));
  for (const cursorText of ['-1', '1.5', '9007199254740992']) {
    await httpError(await fetch(ctx.base + `/api/events?after=${cursorText}`), 400, 'INVALID_REQUEST');
  }
});

test('[EXPORT_RETRY_RECHECK] later requirements block fresh and same-ID exports but retain history', async t => {
  const ctx = await session(t);
  const item = await ready(ctx);
  const receipt = await accept(ctx, item);
  const request = exportRequest(receipt);
  const first = await jsonOK(await send(ctx, exportRoute(receipt), request));
  assert.equal(first.reused, false);
  assert.deepEqual(await jsonOK(await send(ctx, exportRoute(receipt), request)), { ...first, reused: true });
  await update(ctx);
  assert.equal((await bootstrap(ctx)).design.acceptedRequirementsMatch, false);
  for (const retry of [request, exportRequest(receipt)]) {
    await httpError(await send(ctx, exportRoute(receipt), retry), 409, 'STATE_CONFLICT');
  }
  assert.deepEqual(await get(ctx, `/api/acceptances/${receipt.acceptance.acceptanceId}`), receipt.acceptance);
  for (const artifact of item.result.artifacts) await download(ctx, artifact, item.bytes.get(artifact.artifactId), 'historical');
  await restart(ctx);
  await httpError(await send(ctx, exportRoute(receipt), request), 409, 'STATE_CONFLICT');
  const later = await accept(ctx, await ready(ctx));
  await jsonOK(await send(ctx, exportRoute(later), exportRequest(later)));
  await httpError(await send(ctx, exportRoute(receipt), exportRequest(receipt)), 409, 'STATE_CONFLICT');
});

test('[DOWNLOAD_INTEGRITY] same-length registered byte tampering blocks downloads, acceptance and export', async t => {
  for (const alreadyAccepted of [false, true]) {
    const ctx = await session(t);
    const item = await ready(ctx);
    const artifact = item.result.artifacts.find(a => a.mediaType === 'model/step');
    const receipt = alreadyAccepted ? await accept(ctx, item) : null;
    const e = receipt && exportRequest(receipt);
    if (receipt) await jsonOK(await send(ctx, exportRoute(receipt), e));
    await download(ctx, artifact, item.bytes.get(artifact.artifactId), alreadyAccepted ? 'current' : 'historical');
    const before = await bootstrap(ctx);
    const file = path.join(ctx.directory, 'artifacts', artifact.artifactId);
    const original = await readFile(file);
    const tampered = Buffer.from(original);
    tampered[0] ^= 1;
    assert.equal(tampered.length, artifact.bytes);
    assert.notEqual(sha(tampered), artifact.sha256);
    await chmod(file, 0o600);
    await writeFile(file, tampered);
    await httpError(await fetch(ctx.base + artifact.href), 500, 'EXECUTION_FAILED');
    await httpError(await send(ctx, acceptRoute(item.result), acceptRequest(ctx, item.result)), 409, 'EVIDENCE_CONFLICT');
    if (receipt) {
      for (const request of [e, exportRequest(receipt)]) {
        await httpError(await send(ctx, exportRoute(receipt), request), 409, 'EVIDENCE_CONFLICT');
      }
    }
    assert.deepEqual(await bootstrap(ctx), before);
    assert.equal((await history(ctx)).acceptances.length, alreadyAccepted ? 1 : 0);
    await writeFile(file, original);
    await chmod(file, 0o400);
    await download(ctx, artifact, original, alreadyAccepted ? 'current' : 'historical');
    if (receipt) await jsonOK(await send(ctx, exportRoute(receipt), e));
    else await accept(ctx, item);
  }
});

test('[HTTP_BODY_LIMIT] actual UTF-8 request bytes enforce the exact 8 KiB cap', async t => {
  const ctx = await session(t);
  const rawSend = body => fetch(ctx.base + '/api/runs', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body });
  const request = { ...runRequest(ctx), instruction: '界'.repeat(1900) };
  const raw = JSON.stringify(request);
  assert.ok(raw.length < 8192);
  assert.ok(Buffer.byteLength(raw) < 8192);
  const exact = raw + ' '.repeat(8192 - Buffer.byteLength(raw));
  assert.equal(Buffer.byteLength(exact), 8192);
  await httpError(await rawSend(exact), 503, 'TOOL_UNAVAILABLE');
  assert.ok((exact + ' ').length < 8192, 'Byte overflow is below the JS character limit');
  await httpError(await rawSend(exact + ' '), 413, 'INVALID_REQUEST');
  assert.deepEqual((await bootstrap(ctx)).runs, []);
  const valid = updateRequest(ctx);
  const body = JSON.stringify(valid);
  const response = await fetch(ctx.base + updateRoute(ctx), { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: body + ' '.repeat(8192 - Buffer.byteLength(body)) });
  await jsonOK(response);
  assert.equal(ctx.store.getRequirements().setup.dimensions.lengthMm, 40);
});

test('[HTTP_DUPLICATE_JSON] duplicate and escaped-equivalent keys are rejected before HTTP parsing loses them', async t => {
  const ctx = await session(t);
  const control = updateRequest(ctx);
  const raw = JSON.stringify(control);
  const bodies = [
    raw.replace('"confirmedIntent":{', '"confirmedIntent":{"lengthMm":30,'),
    raw.replace('"confirmedIntent":{', '"confirmedIntent":{"length\\u004dm":30,'),
    raw.replace('{', '{"requestId":"earlier_id",'),
  ];
  const before = await bootstrap(ctx);
  for (const body of bodies) {
    const response = await fetch(ctx.base + updateRoute(ctx), { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body });
    await httpError(response, 400, 'INVALID_REQUEST');
    assert.deepEqual(await bootstrap(ctx), before);
  }
  await update(ctx, control);
  assert.equal(ctx.store.getRequirements().setup.dimensions.lengthMm, 40);
});

test('[LATE_RESULT] superseded completion is retained without changing current selection', async t => {
  const ctx = await session(t);
  const accepted = await accept(ctx, await ready(ctx));
  const late = await prepare(ctx);
  await update(ctx);
  const current = await ready(ctx);
  const before = ctx.store.getDesign();
  const retained = await ctx.store.completeCandidate(late.result);
  assert.equal(retained.status, 'superseded');
  assert.equal(retained.requirementsVersion, 1);
  assert.deepEqual(retained.artifacts, late.result.artifacts);
  assert.deepEqual(retained.checks, late.result.checks);
  const state = await bootstrap(ctx);
  assert.equal(state.design.selectedCandidateRevisionId, current.result.revisionId);
  assert.equal(state.design.acceptedRevisionId, accepted.acceptance.candidate.revisionId);
  assert.equal(state.design.activeRequirementsVersion, 2);
  assert.equal(state.design.stateVersion, before.stateVersion + 1);
  assert.equal(RunSchema.parse(await get(ctx, `/api/runs/${late.run.runId}`)).status, 'superseded');
  assert.deepEqual(await get(ctx, `/api/candidates/${late.result.revisionId}`), retained);
  await httpError(await send(ctx, acceptRoute(late.result), acceptRequest(ctx, late.result)), 409, 'STATE_CONFLICT');
  await restart(ctx);
  assert.deepEqual(ctx.store.getCandidate(late.result.revisionId), retained);
});

test('[RESTART_INTERRUPT] interrupted queued, planning and running work fails exactly once', async t => {
  for (const phase of ['queued', 'planning', 'running']) {
    const ctx = await session(t);
    const item = await prepare(ctx);
    if (phase !== 'queued') await ctx.store.planning(item.run.runId);
    if (phase === 'running') await ctx.store.running(item.run.runId);
    const before = ctx.store.getDesign();
    const cursor = ctx.store.getEvents().at(-1).eventId;
    assert.equal(ctx.store.getRun(item.run.runId).status, phase);
    await restart(ctx);
    const run = await get(ctx, `/api/runs/${item.run.runId}`);
    assert.equal(run.status, 'failed');
    assert.equal(run.activeAttemptId, null);
    assert.deepEqual(run.error, safeError('EXECUTION_FAILED'));
    assert.equal(ctx.store.getCandidate(item.result.revisionId).status, 'failed');
    assert.equal(ctx.store.getDesign().activeRunId, null);
    assert.equal(ctx.store.getDesign().stateVersion, before.stateVersion + 1);
    assert.deepEqual(ctx.store.getEvents(undefined, cursor).map(e => e.type), ['candidate.failed', 'run.failed']);
    const state = await bootstrap(ctx);
    const events = ctx.store.getEvents();
    await restart(ctx);
    assert.deepEqual(await bootstrap(ctx), state);
    assert.deepEqual(ctx.store.getEvents(), events);
    const retry = await jsonOK(await send(ctx, '/api/runs', item.request));
    assert.equal(retry.reused, true);
    assert.equal(retry.run.runId, run.runId);
    assert.equal(retry.run.status, 'failed');
    assert.deepEqual((await history(ctx)).acceptances, []);
  }
});

test('[UNAVAILABLE_VISIBLE] absent adapters return safe unavailability without silent fixture success', async t => {
  const ctx = await session(t);
  const health = await get(ctx, '/api/health');
  assert.equal(health.providerConfigured, false);
  assert.equal(health.executionMode, 'unavailable');
  const before = await bootstrap(ctx);
  assert.equal(before.executionMode, 'unavailable');
  assert.match(before.unavailableReason, /engineering runtime and generation provider are unavailable/);
  await httpError(await send(ctx, '/api/runs', runRequest(ctx)), 503, 'TOOL_UNAVAILABLE');
  assert.deepEqual(await bootstrap(ctx), before);
  assert.deepEqual(ctx.store.getEvents(), []);
  assert.deepEqual((await history(ctx)).manifests, []);
});

test('[FAILED_EVIDENCE] each failed or not_evaluated required check blocks acceptance', async t => {
  const ctx = await session(t);
  const positive = await accept(ctx, await ready(ctx));
  for (const checkState of ['failed', 'not_evaluated']) {
    for (const failedCheck of ctx.requirements.requiredChecks) {
      const item = await ready(ctx, { failedCheck, checkState });
      const evidence = await get(ctx, `/api/candidates/${item.result.revisionId}`);
      assert.equal(evidence.status, 'rejected');
      assert.equal(evidence.checks.find(c => c.checkId === failedCheck).state, checkState);
      assert.equal(evidence.checks.filter(c => c.state === 'passed').length, 6);
      const before = ctx.store.getDesign();
      await httpError(await send(ctx, acceptRoute(item.result), acceptRequest(ctx, item.result)), 409, 'EVIDENCE_CONFLICT');
      assert.deepEqual(ctx.store.getDesign(), before);
      assert.equal(ctx.store.getDesign().acceptedRevisionId, positive.acceptance.candidate.revisionId);
      assert.deepEqual((await history(ctx)).acceptances, [positive.acceptance]);
    }
  }
});

test('[RESET_REPEAT] two independent clean software sessions never share IDs or artifact bytes', async t => {
  const sessions = [await session(t), await session(t)];
  assert.notEqual(sessions[0].directory, sessions[1].directory);
  assert.notEqual(sessions[0].base, sessions[1].base);
  const completed = [];
  for (const ctx of sessions) {
    assert.equal(ctx.store.getDesign().stateVersion, 0);
    const item = await ready(ctx);
    const receipt = await accept(ctx, item);
    await jsonOK(await send(ctx, exportRoute(receipt), exportRequest(receipt)));
    for (const artifact of receipt.manifest.artifacts) await download(ctx, artifact, item.bytes.get(artifact.artifactId), 'current');
    await restart(ctx);
    assert.deepEqual((await history(ctx)).acceptances, [receipt.acceptance]);
    completed.push({ item, receipt });
  }
  const ids = completed.flatMap(({ item, receipt }) => [item.run.runId, item.result.revisionId,
    receipt.acceptance.acceptanceId, receipt.manifest.manifestId, ...item.result.artifacts.map(a => a.artifactId)]);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(completed[0].item.result.geometryHash, completed[1].item.result.geometryHash);
  for (const i of [0, 1]) {
    const foreign = completed[1 - i].item.result.artifacts[0];
    await httpError(await fetch(sessions[i].base + foreign.href), 404, 'INVALID_REQUEST');
    assert.equal(sessions[i].store.listRuns().length, 1);
  }
});
