import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { CONTRACT_VERSION, type Artifact, type Check, type Design, type Run, type RunRequest } from '../../src/shared/contracts.js';
import { RunStore, StoreError } from '../../src/server/store.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const design: Design = { designId: 'design_test', label: 'Test reference', currentRevisionId: 'revision_initial', latestRunId: null, units: 'mm' };
const provider = { name: 'test-provider', requestedModel: 'test-model', reportedModel: 'test-model' };
const operation = { name: 'test_edit', parameters: { height: 20 } };

function setup(selectedDesign: Design | null = design): { directory: string; store: RunStore } {
  const directory = mkdtempSync(join(tmpdir(), 'worldkinetics-store-test-'));
  directories.push(directory);
  return { directory, store: new RunStore(directory, selectedDesign) };
}

function request(requestId: string, inputRevisionId = design.currentRevisionId): RunRequest {
  return { contractVersion: CONTRACT_VERSION, requestId, designId: design.designId, inputRevisionId, units: 'mm', instruction: 'Set height to 20 mm' };
}

function start(store: RunStore, input: RunRequest): Run {
  const { run } = store.accept(input);
  store.planning(run.runId, provider);
  return store.running(run.runId, operation);
}

function evidence(run: Run): { checks: Check[]; artifacts: Artifact[] } {
  return {
    checks: [{ checkId: 'height', label: 'Height', revisionId: run.outputRevisionId, state: 'passed', method: 'test measurement', details: 'Measured by the test adapter.', measuredValue: 20, expected: '20', units: 'mm' }],
    artifacts: [{ artifactId: `artifact_${run.runId}`, runId: run.runId, designId: run.designId, revisionId: run.outputRevisionId, units: 'mm', kind: 'editable', fileName: 'revision.json', mediaType: 'application/json', bytes: 2, sha256: '0'.repeat(64), href: `/api/artifacts/artifact_${run.runId}`, executionMode: 'live' }],
  };
}

function complete(store: RunStore, run: Run): Run {
  const { checks, artifacts } = evidence(run);
  return store.complete(run.runId, checks, artifacts);
}

function hasError(status: number, code: string): (error: unknown) => boolean {
  return (error) => error instanceof StoreError && error.status === status && error.code === code;
}

test('identical parsed retries reuse the original run before and after revision advancement and restart', () => {
  const { directory, store } = setup();
  const input = request('request_first');
  const run = start(store, { ...input, instruction: `  ${input.instruction}  ` });
  assert.equal(store.accept(input).run.runId, run.runId);
  assert.equal(store.accept(input).reused, true);
  assert.equal(store.listRuns().length, 1);
  const completed = complete(store, run);
  assert.equal(completed.evidenceApplicability, 'current');
  assert.equal(store.getDesign()?.currentRevisionId, completed.outputRevisionId);

  const reopened = new RunStore(directory, design);
  assert.equal(reopened.accept(input).run.runId, run.runId);
  assert.equal(reopened.accept(input).reused, true);
  assert.deepEqual(reopened.getEvents(run.runId), store.getEvents(run.runId));
  assert.throws(() => reopened.accept({ ...input, instruction: 'Set height to 30 mm' }), hasError(409, 'REQUEST_ID_CONFLICT'));
  assert.throws(() => reopened.accept(request('request_old')), hasError(409, 'REVISION_CONFLICT'));
});

test('unselected and wrong-design requests fail without creating a run', () => {
  const { store } = setup(null);
  assert.throws(() => store.accept(request('request_unselected')), hasError(503, 'DESIGN_NOT_SELECTED'));
  assert.equal(store.listRuns().length, 0);
  const selected = setup().store;
  assert.throws(() => selected.accept({ ...request('request_wrong'), designId: 'another_design' }), hasError(409, 'DESIGN_CONFLICT'));
});

test('late completion retains its evidence as historical and cannot promote an obsolete revision', () => {
  const { store } = setup();
  const older = start(store, request('request_older'));
  const newer = start(store, request('request_newer'));
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.equal(store.getDesign()?.latestRunId, newer.runId);
  assert.equal(complete(store, newer).evidenceApplicability, 'current');
  const late = complete(store, older);
  assert.equal(late.status, 'superseded');
  assert.equal(late.evidenceApplicability, 'historical');
  assert.equal(late.checks.length, 1);
  assert.equal(store.getDesign()?.currentRevisionId, newer.outputRevisionId);
  assert.equal(store.getEvents(older.runId).at(-1)?.type, 'run.superseded');
  assert.ok(store.getEvents(older.runId).every((event) => event.run.evidenceApplicability !== 'current'));
});

test('superseded pending completion does not advance current even before the newest run completes', () => {
  const { store } = setup();
  const older = start(store, request('request_older'));
  const newer = start(store, request('request_newer'));
  assert.equal(complete(store, older).status, 'superseded');
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.equal(complete(store, newer).evidenceApplicability, 'current');
});

test('previously current completion events become historical when a new request is accepted', () => {
  const { directory, store } = setup();
  const older = start(store, request('request_older'));
  complete(store, older);
  const completionId = store.getEvents(older.runId).at(-1)!.eventId;
  start(store, request('request_newer', older.outputRevisionId));
  assert.equal(store.getRun(older.runId).evidenceApplicability, 'historical');
  assert.equal(store.listRuns().find((run) => run.runId === older.runId)?.evidenceApplicability, 'historical');
  assert.equal(store.getEvents(older.runId).at(-1)?.run.evidenceApplicability, 'historical');
  assert.equal(store.getEvents(older.runId, completionId).length, 0);
  assert.equal(new RunStore(directory, design).getEvents(older.runId).at(-1)?.run.evidenceApplicability, 'historical');
});

test('restart fails interrupted work once and preserves accepted request identity and monotonic event IDs', () => {
  const { directory, store } = setup();
  const queued = store.accept(request('request_queued')).run;
  const running = start(store, request('request_running'));
  const lastBefore = store.getEvents(running.runId).at(-1)!.eventId;
  const reopened = new RunStore(directory, design);
  for (const run of [queued, running]) {
    assert.equal(reopened.getRun(run.runId).status, 'failed');
    assert.equal(reopened.getRun(run.runId).error?.code, 'RUN_INTERRUPTED');
    assert.equal(reopened.getRun(run.runId).evidenceApplicability, 'unavailable');
    assert.equal(reopened.getEvents(run.runId).at(-1)?.type, 'run.failed');
    assert.ok(reopened.getEvents(run.runId).at(-1)!.eventId > lastBefore);
  }
  assert.equal(reopened.accept(request('request_running')).run.runId, running.runId);
  assert.equal(reopened.accept(request('request_running')).reused, true);
  assert.equal(reopened.getDesign()?.currentRevisionId, design.currentRevisionId);
  const secondReopen = new RunStore(directory, design);
  assert.deepEqual(secondReopen.getEvents(running.runId), reopened.getEvents(running.runId));
});

test('mismatched revision or run evidence is rejected without mutating the run', () => {
  const { store } = setup();
  const run = start(store, request('request_mismatch'));
  const { checks, artifacts } = evidence(run);
  const beforeEvents = store.getEvents(run.runId);
  assert.throws(() => store.complete(run.runId, [{ ...checks[0]!, revisionId: 'revision_other' }], artifacts), hasError(409, 'EVIDENCE_REVISION_MISMATCH'));
  assert.throws(() => store.complete(run.runId, checks, [{ ...artifacts[0]!, runId: 'run_other' }]), hasError(409, 'EVIDENCE_REVISION_MISMATCH'));
  assert.deepEqual(store.getEvents(run.runId), beforeEvents);
  assert.equal(store.getRun(run.runId).status, 'running');
  assert.equal(store.getRun(run.runId).checks.length, 0);
  assert.equal(complete(store, run).status, 'succeeded');
});

test('fixture evidence is labeled and never advances the authoritative revision', () => {
  const { directory, store } = setup();
  const run = start(store, request('request_fixture'));
  const { checks, artifacts } = evidence(run);
  const result = store.complete(run.runId, checks, artifacts.map((artifact) => ({ ...artifact, executionMode: 'fixture' })));
  assert.equal(result.executionMode, 'fixture');
  assert.equal(result.evidenceApplicability, 'fixture');
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.equal(new RunStore(directory, design).getRun(run.runId).evidenceApplicability, 'fixture');
});

test('callers cannot mutate authoritative design, runs, or event evidence through returned objects', () => {
  const { store } = setup();
  const run = start(store, request('request_snapshot'));
  const finished = complete(store, run);
  finished.checks[0]!.state = 'failed';
  store.getDesign()!.currentRevisionId = 'revision_injected';
  store.getEvents(run.runId).at(-1)!.run.artifacts[0]!.runId = 'run_injected';
  assert.equal(store.getRun(run.runId).checks[0]!.state, 'passed');
  assert.equal(store.getRun(run.runId).artifacts[0]!.runId, run.runId);
  assert.equal(store.getDesign()?.currentRevisionId, run.outputRevisionId);
});

test('corrupt state is reported and preserved instead of silently resetting run history', () => {
  const { directory } = setup();
  const snapshotPath = join(directory, 'state.json');
  writeFileSync(snapshotPath, '{invalid');
  assert.throws(() => new RunStore(directory, design), hasError(500, 'STORE_CORRUPT'));
  assert.equal(readFileSync(snapshotPath, 'utf8'), '{invalid');
});
