import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { BootstrapSchema, CONTRACT_VERSION, computeCheckBundleHash, createRequirements, expectedForCheck, hashCanonical, type Candidate, type Design, type Run, type RunRequest, type AcceptanceRequest, type Requirements, type PlateRequirements } from '../../src/shared/contracts.js';
import { RunStore, StoreError, requirementIdentity } from '../../src/server/store.js';

function plate(value: Requirements): PlateRequirements { assert(value.registryId === 'plate_requirements_v1'); return value; }
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const fixture = BootstrapSchema.parse(JSON.parse(readFileSync(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url), 'utf8')));
const bytes = JSON.parse(readFileSync(new URL('../../fixtures/api/v2/synthetic-artifact-bytes.fixture.json', import.meta.url), 'utf8')).artifacts as Record<string, string>;
const requirements = await createRequirements({ designId: 'design_test', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
const design: Design = { ...fixture.design!, designId: requirements.designId, stateVersion: 0, activeRequirementsVersion: 1, baselineRevisionId: 'revision_initial', activeRunId: null, selectedCandidateRevisionId: null, setupHash: requirements.setupHash };
function setup(selectedDesign: Design | null = design) {
  const directory = mkdtempSync(join(tmpdir(), 'worldkinetics-store-test-')); directories.push(directory);
  return { directory, store: new RunStore(directory, selectedDesign, selectedDesign ? requirements : undefined) };
}
function request(requestId: string, inputRevisionId = design.baselineRevisionId): RunRequest {
  return { contractVersion: CONTRACT_VERSION, requestId, designId: design.designId, inputRevisionId, units: 'mm', instruction: 'Set length to 36 mm', requirementsVersion: 1, setupId: requirements.setupId };
}
async function start(store: RunStore, input: RunRequest): Promise<Run> {
  const { run } = await store.enqueueRun(input); await store.planning(run.runId); return store.running(run.runId);
}
async function evidence(store: RunStore, directory: string, run: Run): Promise<Candidate> {
  // These bytes and measurements are synthetic state fixtures, never CAD evidence.
  const draft = store.getCandidate(run.candidateRevisionIds[0]!); const r = draft.requirements;
  const result: Candidate = { ...fixture.candidates[0]!, ...draft, status: 'reviewable',
    engine: { name: 'build123d', version: 'synthetic', imageDigest: 'sha256:' + '1'.repeat(64) },
    sourceSha256: fixture.candidates[0]!.sourceSha256, geometryHash: fixture.candidates[0]!.geometryHash,
    proposalHash: await hashCanonical({ kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: 36 } } }),
    checks: fixture.candidates[0]!.checks.map(c => ({ ...c, ...requirementIdentity(r), revisionId: draft.revisionId, executionMode: 'live', expected: expectedForCheck(r, c.checkId) })), artifacts: [] };
  mkdirSync(join(directory, 'artifacts'), { recursive: true });
  for (const a of fixture.candidates[0]!.artifacts) {
    const artifactId = `artifact_${randomUUID()}`;
    writeFileSync(join(directory, 'artifacts', artifactId), bytes[a.artifactId]!);
    result.artifacts.push({ ...a, ...requirementIdentity(r), artifactId, runId: run.runId, designId: run.designId, revisionId: draft.revisionId, executionMode: 'live', href: `/api/artifacts/${artifactId}` });
  }
  result.checkBundleHash = await computeCheckBundleHash(result); return result;
}
async function complete(store: RunStore, directory: string, run: Run) { return store.completeCandidate(await evidence(store, directory, run)); }
function acceptance(store: RunStore, c: Candidate, requestId = `accept_${randomUUID()}`): AcceptanceRequest {
  const d = store.getDesign()!;
  return { contractVersion: CONTRACT_VERSION, requestId, designId: d.designId, candidateRevisionId: c.revisionId, requirementsVersion: c.requirementsVersion,
    expectedStateVersion: d.stateVersion, expectedAcceptedRevisionId: d.acceptedRevisionId, registryHash: c.registryHash, setupHash: c.setupHash,
    geometryHash: c.geometryHash!, checkBundleHash: c.checkBundleHash!, userActionId: `action_${randomUUID()}` };
}
const conflict = (error: unknown) => error instanceof StoreError && error.status === 409;

test('identical parsed retries reuse the original run before and after explicit acceptance and restart', async () => {
  const { directory, store } = setup(); const input = request('request_first');
  const run = await start(store, { ...input, instruction: `  ${input.instruction}  ` });
  assert.equal((await store.enqueueRun(input)).run.runId, run.runId); assert.equal((await store.enqueueRun(input)).reused, true); assert.equal(store.listRuns().length, 1);
  const c = await complete(store, directory, run); assert.equal(store.getDesign()!.acceptedRevisionId, null);
  await store.acceptRevision(acceptance(store, c)); assert.equal(store.getDesign()!.acceptedRevisionId, c.revisionId);
  const reopened = new RunStore(directory, design, requirements);
  assert.equal((await reopened.enqueueRun(input)).run.runId, run.runId); assert.equal((await reopened.enqueueRun(input)).reused, true);
  assert.deepEqual(reopened.getEvents(run.runId), store.getEvents(run.runId));
  await assert.rejects(reopened.enqueueRun({ ...input, instruction: 'Different' }), conflict);
  await assert.rejects(reopened.enqueueRun(request('request_old')), conflict);
});
test('unselected and wrong-design requests fail without creating a run', async () => {
  const { store } = setup(null); await assert.rejects(store.enqueueRun(request('request_unselected')), (e: unknown) => e instanceof StoreError && e.status === 503);
  assert.equal(store.listRuns().length, 0);
  await assert.rejects(setup().store.enqueueRun({ ...request('request_wrong'), designId: 'another_design' }), conflict);
});
test('late completion retains historical evidence and cannot select or accept an obsolete revision', async () => {
  const { directory, store } = setup(); const older = await start(store, request('older')); const newer = await start(store, request('newer'));
  assert.equal(store.getDesign()!.acceptedRevisionId, null); assert.equal(store.getDesign()!.activeRunId, newer.runId);
  const current = await complete(store, directory, newer); await store.acceptRevision(acceptance(store, current));
  const late = await complete(store, directory, older); assert.equal(late.status, 'superseded'); assert.equal(late.checks.length, 7);
  assert.equal(store.getDesign()!.acceptedRevisionId, current.revisionId); assert.equal(store.getDesign()!.selectedCandidateRevisionId, current.revisionId);
  assert.equal(store.getEvents(older.runId).at(-1)!.type, 'run.superseded');
  assert.ok(store.getEvents(older.runId).every(e => e.type !== 'revision.accepted'));
});
test('superseded pending completion cannot select even before the newest run completes', async () => {
  const { directory, store } = setup(); const older = await start(store, request('older')); const newer = await start(store, request('newer'));
  assert.equal((await complete(store, directory, older)).status, 'superseded'); assert.equal(store.getDesign()!.acceptedRevisionId, null);
  const c = await complete(store, directory, newer); assert.equal(store.getDesign()!.selectedCandidateRevisionId, c.revisionId);
});
test('earlier completion events remain immutable history after a new request and restart', async () => {
  const { directory, store } = setup(); const older = await start(store, request('older')); const c = await complete(store, directory, older);
  const events = store.getEvents(older.runId); const completionId = events.at(-1)!.eventId;
  await start(store, request('newer')); assert.equal(store.getDesign()!.selectedCandidateRevisionId, null);
  assert.equal(store.getCandidate(c.revisionId).revisionId, c.revisionId); assert.deepEqual(store.getEvents(older.runId), events);
  assert.equal(store.getEvents(older.runId, completionId).length, 0);
  assert.deepEqual(new RunStore(directory, design, requirements).getEvents(older.runId), events);
});
test('restart fails pending work once, preserves request identities and monotonic events', async () => {
  const { directory, store } = setup(); const queued = (await store.enqueueRun(request('queued'))).run; const running = await start(store, request('running'));
  const lastBefore = store.getEvents().at(-1)!.eventId; const reopened = new RunStore(directory, design, requirements);
  assert.equal(reopened.getRun(queued.runId).status, 'superseded');
  assert.equal(reopened.getRun(running.runId).status, 'failed'); assert.equal(reopened.getRun(running.runId).error!.code, 'EXECUTION_FAILED');
  assert.equal(reopened.getEvents(running.runId).at(-1)!.type, 'run.failed'); assert.ok(reopened.getEvents(running.runId).at(-1)!.eventId > lastBefore);
  for (const run of [queued, running]) assert.equal((await reopened.enqueueRun(request(run.requestId))).run.runId, run.runId);
  assert.equal(reopened.getDesign()!.acceptedRevisionId, null);
  assert.deepEqual(new RunStore(directory, design, requirements).getEvents(), reopened.getEvents());
});
test('mismatched revision or run evidence is rejected without mutating the run', async () => {
  const { directory, store } = setup(); const run = await start(store, request('mismatch')); const c = await evidence(store, directory, run); const before = store.getEvents();
  await assert.rejects(store.completeCandidate({ ...c, checks: [{ ...c.checks[0]!, revisionId: 'wrong' }, ...c.checks.slice(1)] }), conflict);
  await assert.rejects(store.completeCandidate({ ...c, artifacts: [{ ...c.artifacts[0]!, runId: 'wrong' }, ...c.artifacts.slice(1)] }), conflict);
  assert.deepEqual(store.getEvents(), before); assert.equal(store.getRun(run.runId).status, 'running'); assert.equal(store.getCandidate(c.revisionId).checks.length, 0);
  assert.equal((await store.completeCandidate(c)).status, 'reviewable');
});
test('fixture evidence is labeled and never becomes accepted', async () => {
  const { directory, store } = setup(); const run = await start(store, request('fixture')); const c = await evidence(store, directory, run);
  c.executionMode = 'fixture'; c.checks.forEach(c => c.executionMode = 'fixture'); c.artifacts.forEach(a => a.executionMode = 'fixture'); c.checkBundleHash = await computeCheckBundleHash(c);
  // A live queue must fail closed on fixture evidence, rather than relabel the run.
  await assert.rejects(store.completeCandidate(c)); assert.equal(store.getDesign()!.acceptedRevisionId, null);
  assert.equal(new RunStore(directory, design, requirements).getDesign()!.acceptedRevisionId, null);
});
test('callers cannot mutate design, runs, candidates or event evidence through snapshots', async () => {
  const { directory, store } = setup(); const run = await start(store, request('snapshots')); const c = await complete(store, directory, run);
  c.checks[0]!.state = 'failed'; store.getDesign()!.acceptedRevisionId = 'injected'; store.getEvents(run.runId).at(-1)!.candidate!.artifacts[0]!.runId = 'injected';
  store.getRun(run.runId).status = 'failed'; plate(store.getRequirements()!).setup.dimensions.lengthMm = 100;
  assert.equal(store.getCandidate(c.revisionId).checks[0]!.state, 'passed'); assert.equal(store.getCandidate(c.revisionId).artifacts[0]!.runId, run.runId);
  assert.equal(store.getDesign()!.acceptedRevisionId, null); assert.equal(store.getRun(run.runId).status, 'completed'); assert.equal(plate(store.getRequirements()!).setup.dimensions.lengthMm, 36);
});
test('corrupt state is reported and preserved instead of silently resetting history', () => {
  const { directory } = setup(); writeFileSync(join(directory, 'state.json'), '{invalid');
  assert.throws(() => new RunStore(directory, design, requirements), (e: unknown) => e instanceof StoreError && e.code === 'STORE_CORRUPT');
  assert.equal(readFileSync(join(directory, 'state.json'), 'utf8'), '{invalid');
});
test('acceptance and update races serialize in both orders; retries do not restore older acceptance', async () => {
  for (const acceptFirst of [true, false]) {
    const { directory, store } = setup(); const c = await complete(store, directory, await start(store, request('race')));
    const a = acceptance(store, c); const u = { contractVersion: CONTRACT_VERSION, requestId: 'update', expectedStateVersion: store.getDesign()!.stateVersion,
      expectedRequirementsVersion: 1, setupId: 'resize_centered_v1' as const, confirmedIntent: { lengthMm: 30 }, userActionId: 'confirm' };
    const results = await Promise.allSettled(acceptFirst ? [store.acceptRevision(a), store.updateRequirements(u)] : [store.updateRequirements(u), store.acceptRevision(a)]);
    assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
    if (acceptFirst) {
      const update = { ...u, expectedStateVersion: store.getDesign()!.stateVersion };
      const original = await store.updateRequirements(update); const restarted = new RunStore(directory, design, requirements);
      assert.deepEqual((await restarted.updateRequirements(update)).design, original.design);
      await restarted.acceptRevision(a); assert.equal(restarted.getDesign()!.acceptedRequirementsMatch, false);
    }
    assert.equal(plate(store.getRequirements()!).setup.dimensions.lengthMm, 30);
  }
});
test('concurrent acceptance, input mutation, cross-operation collisions and failed CAS retries', async () => {
  const { directory, store } = setup(); const c = await complete(store, directory, await start(store, request('concurrent')));
  const a = acceptance(store, c); const mutable = structuredClone(a); const pending = store.acceptRevision(mutable); mutable.geometryHash = '0'.repeat(64);
  const other = store.acceptRevision({ ...a, requestId: 'competing' }); const outcomes = await Promise.allSettled([pending, other]);
  assert.equal(outcomes[0]!.status, 'fulfilled'); assert.equal(outcomes[1]!.status, 'rejected');
  await assert.rejects(store.enqueueRun(request(a.requestId, c.revisionId)), conflict);
  const retry = await store.acceptRevision({ ...a, requestId: 'competing', expectedStateVersion: store.getDesign()!.stateVersion, expectedAcceptedRevisionId: c.revisionId });
  assert.equal(retry.reused, false);
});
test('acceptance verifies every artifact and export requires exact current acceptance and manifest', async () => {
  const { directory, store } = setup(); const c = await complete(store, directory, await start(store, request('export')));
  const accepted = await store.acceptRevision(acceptance(store, c)); const { manifest } = accepted;
  const exportRequest = { contractVersion: CONTRACT_VERSION, requestId: 'export_request', acceptanceId: accepted.acceptance.acceptanceId, manifestId: manifest.manifestId, manifestHash: manifest.manifestHash };
  assert.equal((await store.exportRevision(c.revisionId, exportRequest)).reused, false);
  assert.equal((await new RunStore(directory, design, requirements).exportRevision(c.revisionId, exportRequest)).reused, true);
  await assert.rejects(store.exportRevision(c.revisionId, { ...exportRequest, manifestHash: '0'.repeat(64) }), conflict);
  const a = c.artifacts[0]!; const target = join(directory, 'artifacts', a.artifactId); const content = readFileSync(target);
  writeFileSync(target, 'tampered'); await assert.rejects(store.exportRevision(c.revisionId, exportRequest), conflict);
  writeFileSync(target, content); rmSync(target); writeFileSync(join(directory, 'target'), content); symlinkSync(join(directory, 'target'), target);
  await assert.rejects(store.acceptRevision(acceptance(store, c)), conflict);
  assert.equal(createHash('sha256').update(content).digest('hex'), a.sha256);
});

test('complete evidence without a registered editable deliverable fails closed', async () => {
  const { directory, store } = setup(); const c = await evidence(store, directory, await start(store, request('missing_editable')));
  c.artifacts = c.artifacts.filter(a => a.kind !== 'editable');
  await assert.rejects(store.completeCandidate(c), conflict);
  await assert.rejects(store.acceptRevision(acceptance(store, c)), conflict);
  assert.equal(store.getDesign()!.acceptedRevisionId, null);
});
test('legitimate failed and unevaluated reports remain inspectable, preserving earlier acceptance', async () => {
  for (const state of ['failed', 'not_evaluated'] as const) {
    const { directory, store } = setup(); const first = await complete(store, directory, await start(store, request('first')));
    await store.acceptRevision(acceptance(store, first));
    const later = await evidence(store, directory, await start(store, request('later', first.revisionId)));
    later.status = 'rejected'; later.checks[0]!.state = state; later.checkBundleHash = await computeCheckBundleHash(later);
    await store.completeCandidate(later); await assert.rejects(store.acceptRevision(acceptance(store, later)), conflict);
    assert.equal(store.getCandidate(later.revisionId).status, 'rejected'); assert.equal(store.getCandidate(later.revisionId).checks[0]!.state, state);
    assert.equal(store.getDesign()!.acceptedRevisionId, first.revisionId); assert.equal(store.getDesign()!.acceptedRequirementsMatch, true);
  }
});
test('snapshot tampering cannot alter accepted manifests, evidence or request history', async () => {
  const { directory, store } = setup(); const c = await complete(store, directory, await start(store, request('snapshot_integrity')));
  await store.acceptRevision(acceptance(store, c)); const file = join(directory, 'state.json'); const original = readFileSync(file, 'utf8');
  for (const mutation of ['manifest', 'check', 'request', 'accepted'] as const) {
    const s = JSON.parse(original);
    if (mutation === 'manifest') s.manifests[0].sourceSha256 = '0'.repeat(64);
    if (mutation === 'check') s.candidates[0].checks[0].measured = { tampered: true };
    if (mutation === 'request') s.requests = [];
    if (mutation === 'accepted') s.design.acceptedRevisionId = null;
    const tampered = JSON.stringify(s); writeFileSync(file, tampered);
    assert.throws(() => new RunStore(directory, design, requirements)); assert.equal(readFileSync(file, 'utf8'), tampered);
  }
  writeFileSync(file, original);
});
