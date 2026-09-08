import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { mock } from 'node:test';
import { BootstrapSchema, type Bootstrap, type Event } from '../../src/shared/contracts-v2.js';
import { createReviewController, reviewProjection, verifyBootstrap } from '../../src/client/workspace/review-state.js';

const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../../fixtures/api/v2/${name}.fixture.json`, import.meta.url), 'utf8'));
const combined = async (): Promise<Bootstrap> => {
  const current = await fixture('reviewable');
  const old = await fixture('rejected');
  current.runs.push(...old.runs);
  current.candidates.push(...old.candidates);
  return BootstrapSchema.parse(current);
};
const holdFirstDigest = () => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let release!: () => void;
  let entered!: () => void;
  let first = true;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const patched = mock.method(globalThis.crypto.subtle, 'digest', async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
    if (first) { first = false; entered(); await waiting; }
    return digest(algorithm, data);
  });
  return { started, release, restore: () => patched.mock.restore() };
};

test('reviewable fixture is selected, never accepted or downloadable', async () => {
  const controller = createReviewController();
  await controller.loadBootstrap(await fixture('reviewable'));
  const state = controller.snapshot();
  const view = reviewProjection(state);
  assert.equal(state.bootstrap?.design?.selectedCandidateRevisionId, 'fixture_36_revision');
  assert.equal(state.bootstrap?.design?.acceptedRevisionId, null);
  assert.equal(view.candidate?.revisionId, 'fixture_36_revision');
  assert.equal(view.rows.length, 7);
  assert.ok(view.rows.every(row => row.state === 'passed'));
  assert.equal(view.canAccept, false);
  assert.equal(view.canDownload, false);
  assert.match(view.blockingReasons.join(' '), /fixture|synthetic/i);
});

test('historical inspection preserves current selection, requirements and exact check evidence', async () => {
  const controller = createReviewController();
  await controller.loadBootstrap(await combined());
  controller.selectRevision('fixture_30_revision');
  let state = controller.snapshot();
  let view = reviewProjection(state);
  assert.equal(state.bootstrap?.design?.selectedCandidateRevisionId, 'fixture_36_revision');
  assert.equal(state.bootstrap?.requirements?.requirementsVersion, 2);
  assert.equal(state.bootstrap?.design?.acceptedRevisionId, null);
  assert.equal(view.isHistorical, true);
  assert.equal(view.candidate?.requirementsVersion, 1);
  const margin = view.rows.find(row => row.checkId === 'margin.end_material')!;
  assert.equal(margin.state, 'failed');
  assert.deepEqual(margin.check?.measured, { fixture: true, endMaterialsMm: [2, 2], minimumEndMaterialMm: 2 });
  assert.equal((margin.check?.expected as { minimumEndMaterialMm: number }).minimumEndMaterialMm, 5);
  assert.equal(view.canAccept, false);
  controller.selectRevision('fixture_36_revision');
  view = reviewProjection(controller.snapshot());
  assert.equal(view.isHistorical, false);
  assert.equal(view.candidate?.requirementsVersion, 2);
  assert.deepEqual(view.rows.find(row => row.checkId === 'margin.end_material')?.check?.measured,
    { fixture: true, endMaterialsMm: [5, 5], minimumEndMaterialMm: 5 });
});

test('pending and feature requirements keep missing checks visibly unevaluated', async () => {
  const pending = await fixture('reviewable');
  pending.candidates[0].status = 'checking';
  pending.candidates[0].checkBundleHash = null;
  pending.candidates[0].checks = [];
  pending.runs[0].status = 'running';
  pending.runs[0].activeAttemptId = pending.runs[0].attemptIds[0];
  pending.design.activeRunId = pending.runs[0].runId;
  const controller = createReviewController();
  await controller.loadBootstrap(pending);
  let view = reviewProjection(controller.snapshot());
  assert.equal(view.rows.length, 7);
  assert.ok(view.rows.every(row => row.state === 'not_evaluated' && row.check === null));
  assert.equal(view.canAccept, false);
  const feature = await fixture('feature-requirements');
  const bootstrap = await fixture('reviewable');
  bootstrap.requirements = feature;
  Object.assign(bootstrap.design, { designId: feature.designId, setupId: feature.setupId,
    setupHash: feature.setupHash, referenceId: feature.referenceId, referenceHash: feature.referenceHash,
    activeRequirementsVersion: feature.requirementsVersion, selectedCandidateRevisionId: null, activeRunId: null });
  bootstrap.runs = []; bootstrap.candidates = [];
  await controller.loadBootstrap(bootstrap);
  view = reviewProjection(controller.snapshot());
  assert.equal(view.rows.length, 9);
  assert.ok(view.rows.every(row => row.state === 'not_evaluated'));
  assert.equal(view.canAccept, false);
});

test('invalid structure or asynchronous evidence hashes cannot become displayed success', async () => {
  for (const corrupt of [
    (value: any) => { value.contractVersion = 'wk-backend-draft-0.1'; },
    (value: any) => { value.privatePath = '/private/hidden'; },
    (value: any) => { value.candidates[0].checks.pop(); },
    (value: any) => { value.candidates[0].checks[1] = structuredClone(value.candidates[0].checks[0]); },
    (value: any) => { value.candidates[0].checks[0].revisionId = 'other_revision'; },
    (value: any) => { value.candidates[0].checkBundleHash = '0'.repeat(64); },
    (value: any) => { value.candidates[0].artifacts[0].href = 'https://other.example/file'; },
  ]) {
    const data = await fixture('reviewable'); corrupt(data);
    await assert.rejects(verifyBootstrap(data));
    const controller = createReviewController();
    await controller.loadBootstrap(await fixture('reviewable'));
    await controller.loadBootstrap(data);
    assert.equal(controller.snapshot().bootstrap, null);
    assert.ok(controller.snapshot().error);
    assert.equal(reviewProjection(controller.snapshot()).canAccept, false);
  }
});

test('active requirements hashes are verified even when there are no candidates', async () => {
  const data = await fixture('reviewable');
  const requirements = await fixture('feature-requirements');
  data.requirements = requirements;
  Object.assign(data.design, { designId: requirements.designId, setupId: requirements.setupId,
    setupHash: '0'.repeat(64), referenceId: requirements.referenceId, referenceHash: requirements.referenceHash,
    activeRequirementsVersion: requirements.requirementsVersion, selectedCandidateRevisionId: null, activeRunId: null });
  data.requirements.setupHash = '0'.repeat(64);
  data.runs = []; data.candidates = [];
  assert.doesNotThrow(() => BootstrapSchema.parse(data));
  await assert.rejects(verifyBootstrap(data));
  const controller = createReviewController();
  await controller.loadBootstrap(data);
  assert.equal(controller.snapshot().bootstrap, null);
  assert.ok(controller.snapshot().error);
});

test('newer bootstrap wins while earlier hash verification is still running', { timeout: 3000 }, async () => {
  const controller = createReviewController();
  const old = await fixture('rejected');
  const current = await fixture('reviewable');
  const barrier = holdFirstDigest();
  try {
    const earlier = controller.loadBootstrap(old);
    await barrier.started;
    assert.equal(controller.snapshot().loading, true);
    await controller.loadBootstrap(current);
    barrier.release();
    await earlier;
    assert.equal(controller.snapshot().bootstrap?.design?.stateVersion, 11);
    assert.equal(controller.snapshot().viewedRevisionId, 'fixture_36_revision');
    assert.equal(controller.snapshot().loading, false);
  } finally { barrier.release(); barrier.restore(); }
});

test('events are deduplicated observations and never replace authoritative selection or acceptance', async () => {
  const controller = createReviewController();
  await controller.loadBootstrap(await combined());
  const event: Event = await fixture('event');
  controller.selectRevision('fixture_30_revision');
  await controller.receiveEvent(event);
  await controller.receiveEvent(event);
  let state = controller.snapshot();
  assert.equal(state.activity.length, 1);
  assert.equal(state.activity[0].type, 'candidate.reviewable');
  assert.equal(state.viewedRevisionId, 'fixture_30_revision');
  assert.equal(state.bootstrap?.design?.selectedCandidateRevisionId, 'fixture_36_revision');
  assert.equal(state.bootstrap?.design?.acceptedRevisionId, null);
  assert.equal(state.refreshRequired, true);
  const stale = { ...event, eventId: 3, stateVersion: 7, requirementsVersion: 1,
    type: 'run.completed', runId: 'fixture_30_run', revisionId: null, run: null, candidate: null };
  await controller.receiveEvent(stale);
  await controller.receiveEvent({ ...event, eventId: 99, designId: 'another_design', run: null, candidate: null });
  assert.equal(controller.snapshot().activity.length, 1);
  await controller.receiveEvent({ ...event, eventId: 5 });
  assert.equal(controller.snapshot().activity.length, 2);
});

test('an event still being verified cannot append to a later bootstrap', { timeout: 3000 }, async () => {
  const controller = createReviewController();
  await controller.loadBootstrap(await fixture('reviewable'));
  const event = await fixture('event');
  const replacement = await fixture('rejected');
  const barrier = holdFirstDigest();
  try {
    const oldEvent = controller.receiveEvent(event);
    await barrier.started;
    await controller.loadBootstrap(replacement);
    barrier.release();
    await oldEvent;
    assert.equal(controller.snapshot().bootstrap?.design?.stateVersion, 7);
    assert.equal(controller.snapshot().activity.length, 0);
    assert.equal(controller.snapshot().viewedRevisionId, 'fixture_30_revision');
  } finally { barrier.release(); barrier.restore(); }
});
