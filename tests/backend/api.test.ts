import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { after, afterEach, test } from 'node:test';
import { z } from 'zod';
import {
  BootstrapSchema, CONTRACT_VERSION, EventSchema, RunSchema, createRequirements, computeCheckBundleHash, hashCanonical, expectedForCheck, type Candidate, type ProviderProposal,
  type Design, type Run, type RunRequest, type ToolAdapter, type ToolInput, type ToolResult,
} from '../../src/shared/contracts.js';
import { createApp } from '../../src/server/app.js';
import { ArtifactStore } from '../../src/server/artifacts.js';
import { Executor, type SelectedOperation } from '../../src/server/execution.js';
import { ToolExecutionError } from '../../src/server/errors.js';
import { RunStore, requirementIdentity } from '../../src/server/store.js';

// These adapters exercise transport and storage using JSON files. They perform no CAD operation.
const fixture = BootstrapSchema.parse(JSON.parse(await readFile(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url), 'utf8')));
const requirements = await createRequirements({ designId: 'synthetic_test_design', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
const design: Design = { ...fixture.design!, designId: requirements.designId, stateVersion: 0, activeRequirementsVersion: 1, baselineRevisionId: 'synthetic_initial', activeRunId: null, selectedCandidateRevisionId: null, setupHash: requirements.setupHash };
const operation = { name: 'resize_plate' as const, parameters: { lengthMm: 36 } };
const testBytes = Buffer.from('{"syntheticBackendTest":true,"lengthMm":36}\n');
const testHash = createHash('sha256').update(testBytes).digest('hex');
const directories: string[] = [];
const servers: Server[] = [];
const baselineDir = await mkdtemp(path.join(tmpdir(), 'wk-test-reference-'));
const baselinePath = path.join(baselineDir, 'reference.step');
await writeFile(baselinePath, testBytes);
after(async () => rm(baselineDir, { recursive: true, force: true }));

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function request(requestId: string): RunRequest {
  return { contractVersion: CONTRACT_VERSION, requestId, designId: design.designId, inputRevisionId: design.baselineRevisionId, requirementsVersion: 1, setupId: requirements.setupId, units: 'mm', instruction: 'Produce the synthetic backend test file.' };
}

async function result(input: ToolInput, filePath = 'synthetic.json'): Promise<ToolResult> {
  const r = input.requirements;
  const output: ToolResult = {
    contractVersion: CONTRACT_VERSION, ...requirementIdentity(r), requirements: r, runId: input.runId, requestId: input.requestId, designId: input.designId,
    inputRevisionId: input.inputRevisionId, outputRevisionId: input.outputRevisionId, attemptId: input.attemptId,
    units: 'mm', executionMode: 'live', status: 'completed', proposal: input.proposal, proposalHash: await hashCanonical(input.proposal),
    sourceSha256: testHash, geometryHash: testHash, checkBundleHash: null, error: null,
    engine: { name: 'build123d', version: 'synthetic-test-double', imageDigest: 'sha256:' + '1'.repeat(64) },
    checks: fixture.candidates[0]!.checks.map(c => ({ ...c, ...requirementIdentity(r), revisionId: input.outputRevisionId, geometryHash: testHash, executionMode: 'live', expected: expectedForCheck(r, c.checkId), measured: { synthetic: true } })),
    artifacts: (['source', 'editable', 'export', 'preview'] as const).map((kind, i) => ({ path: filePath, kind, fileName: 'synthetic.json', mediaType: ['application/json', 'text/x-python', 'model/step', 'model/stl'][i]!, bytes: testBytes.length, sha256: testHash, executionMode: 'live' })),
  };
  output.checkBundleHash = await computeCheckBundleHash({ ...output, revisionId: output.outputRevisionId });
  return output;
}
const syntheticTool: ToolAdapter = async input => {
  await writeFile(path.join(input.outputDir, 'synthetic.json'), testBytes);
  return result(input);
};

function selected(tool: ToolAdapter = syntheticTool): SelectedOperation {
  return {
    name: operation.name,
    parameters: z.object({ lengthMm: z.number().min(26).max(200) }).strict(),
    planner: {
      identity: { name: 'injected-backend-test-planner', requestedModel: 'synthetic-test-double', reportedModel: 'synthetic-test-double' },
      propose: async () => ({ kind: 'numeric_operation', operation: structuredClone(operation) }),
    },
    baselineArtifacts: [{ artifactId: 'baseline_test', revisionId: design.baselineRevisionId, kind: 'reference', units: 'mm', path: baselinePath, sha256: testHash }],
    tool,
  };
}

async function setup(initialDesign: Design | null = design) {
  const directory = await mkdtemp(path.join(tmpdir(), 'worldkinetics-api-test-'));
  directories.push(directory);
  return { directory, store: new RunStore(directory, initialDesign, initialDesign ? requirements : undefined) };
}

async function listen(selectedOperation: SelectedOperation | null = null, timeoutMs?: number) {
  const { directory, store } = await setup(selectedOperation ? design : null);
  const server = createApp(store, directory, selectedOperation, timeoutMs);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  return { directory, store, url };
}

function post(url: string, body: unknown) {
  return fetch(`${url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function terminal(url: string, runId: string): Promise<Run> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/runs/${runId}`);
    assert.equal(response.status, 200);
    const run = RunSchema.parse(await response.json());
    if (['completed', 'failed', 'superseded'].includes(run.status)) return run;
    await delay(5);
  }
  throw new Error(`Synthetic test run did not finish: ${runId}`);
}

async function importedFiles(directory: string): Promise<string[]> {
  try { return await readdir(path.join(directory, 'artifacts')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

test('unavailable HTTP responses and labeled fixtures conform to the shared schemas', async () => {
  const { store, url } = await listen();
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', contractVersion: CONTRACT_VERSION, scopeStatus: 'not_selected', providerConfigured: false, executionMode: 'unavailable' });
  const bootstrap = BootstrapSchema.parse(await (await fetch(`${url}/api/bootstrap`)).json());
  assert.equal(bootstrap.scopeStatus, 'not_selected');
  assert.equal(bootstrap.executionMode, 'unavailable');
  assert.equal(bootstrap.design, null);
  assert.match(bootstrap.unavailableReason!, /not selected/);

  const unavailable = await post(url, request('unavailable_request'));
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'TOOL_UNAVAILABLE');
  assert.equal(store.listRuns().length, 0);
  const fixtureResponse = await fetch(`${url}/api/fixtures/run`);
  assert.equal(fixtureResponse.status, 200);
  const fixture = RunSchema.parse(await fixtureResponse.json());
  assert.equal(fixture.executionMode, 'fixture');
  assert.equal(fixture.candidateRevisionIds.length, 1);
  const fixtureEventsResponse = await fetch(`${url}/api/fixtures/events`);
  const fixtureEventsBody = await fixtureEventsResponse.json();
  const fixtureEvents = z.array(EventSchema).parse(Array.isArray(fixtureEventsBody) ? fixtureEventsBody : fixtureEventsBody.events);
  assert.ok(fixtureEvents.length > 0);
  assert.ok(fixtureEvents.every((event) => event.executionMode === 'fixture'));
  const fixtureState = BootstrapSchema.parse(await (await fetch(`${url}/api/fixtures/bootstrap?state=reviewable`)).json());
  const fixtureArtifact = fixtureState.candidates[0]!.artifacts[0]!;
  const download = await fetch(`${url}${fixtureArtifact.href}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('X-WorldKinetics-Execution'), 'fixture');
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.length, fixtureArtifact.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixtureArtifact.sha256);
});

test('HTTP rejects malformed contracts, content types, cursor values and unrelated origins without creating runs', async () => {
  const { store, url } = await listen(selected());
  for (const invalid of [
    { ...request('invalid_version'), contractVersion: 'wrong-version' },
    { ...request('invalid_units'), units: 'inches' },
    { ...request('invalid_field'), arbitrary: 'unsupported' },
    { ...request('invalid_instruction'), instruction: '  ' },
  ]) {
    const response = await post(url, invalid);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  }
  const malformed = await fetch(`${url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST');
  const contentType = await fetch(`${url}/api/runs`, { method: 'POST', body: '{}' });
  assert.equal(contentType.status, 415);
  const origin = await fetch(`${url}/api/bootstrap`, { headers: { Origin: 'http://unrelated.invalid' } });
  assert.equal(origin.status, 403);
  assert.equal(store.listRuns().length, 0);
  const missing = await fetch(`${url}/api/runs/missing_run`);
  assert.equal(missing.status, 404);
  const { run } = await store.enqueueRun(request('cursor_request'));
  const cursor = await fetch(`${url}/api/runs/${run.runId}/events?after=-1`);
  assert.equal(cursor.status, 400);
  assert.equal((await cursor.json()).error.code, 'INVALID_REQUEST');
});

test('synthetic file is downloaded with exact bytes and revision identity, and identical HTTP retries dispatch once', async () => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const tool: ToolAdapter = async (input) => {
    calls += 1;
    entered.resolve();
    await release.promise;
    return syntheticTool(input);
  };
  const { store, url } = await listen(selected(tool));
  const input = request('retry_request');
  const accepted = await post(url, input);
  assert.equal(accepted.status, 202);
  const body = await accepted.json();
  assert.equal(body.contractVersion, CONTRACT_VERSION);
  assert.equal(body.reused, false);
  const acceptedRun = RunSchema.parse(body.run);
  await entered.promise;
  const retry = await post(url, input);
  assert.equal(retry.status, 200);
  const retried = await retry.json();
  assert.equal(retried.reused, true);
  assert.equal(retried.run.runId, acceptedRun.runId);
  assert.equal(calls, 1);
  release.resolve();
  const run = await terminal(url, acceptedRun.runId);
  assert.equal(run.status, 'completed');
  assert.equal(store.getDesign()!.acceptedRevisionId, null);
  const candidate = store.getCandidate(run.candidateRevisionIds[0]!);
  assert.equal(store.getCandidate(run.candidateRevisionIds[0]!).checks[0]?.revisionId, run.candidateRevisionIds[0]!);
  assert.equal(store.getDesign()?.selectedCandidateRevisionId, run.candidateRevisionIds[0]!);
  const acceptance = await fetch(`${url}/api/revisions/${candidate.revisionId}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractVersion: CONTRACT_VERSION, requestId: 'explicit_accept', designId: design.designId, candidateRevisionId: candidate.revisionId, requirementsVersion: 1, expectedStateVersion: store.getDesign()!.stateVersion, expectedAcceptedRevisionId: null, registryHash: candidate.registryHash, setupHash: candidate.setupHash, geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash, userActionId: 'explicit_action' }) });
  assert.equal(acceptance.status, 200);
  assert.equal(store.getDesign()!.acceptedRevisionId, candidate.revisionId);
  const artifact = store.getCandidate(run.candidateRevisionIds[0]!).artifacts[0]!;
  assert.equal(artifact.runId, run.runId);
  assert.equal(artifact.revisionId, run.candidateRevisionIds[0]!);
  const download = await fetch(`${url}${artifact.href}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Length'), String(testBytes.length));
  assert.equal(download.headers.get('Content-Type'), 'application/json');
  assert.equal(download.headers.get('Content-Disposition'), 'attachment; filename="synthetic.json"');
  assert.equal(download.headers.get('X-WorldKinetics-Revision'), run.candidateRevisionIds[0]!);
  assert.equal(download.headers.get('X-WorldKinetics-Execution'), 'live');
  const downloaded = Buffer.from(await download.arrayBuffer());
  assert.deepEqual(downloaded, testBytes);
  assert.equal(artifact.bytes, downloaded.length);
  assert.equal(artifact.sha256, createHash('sha256').update(downloaded).digest('hex'));
  const events = (await (await fetch(`${url}/api/runs/${run.runId}/events`)).json()).events.map((event: unknown) => EventSchema.parse(event));
  assert.deepEqual(events.map((event: z.infer<typeof EventSchema>) => event.type), ['run.queued', 'candidate.building', 'run.planning', 'run.running', 'candidate.checking', 'candidate.reviewable', 'run.completed', 'revision.accepted']);
  assert.ok(events.every((event: z.infer<typeof EventSchema>) => event.revisionId === run.candidateRevisionIds[0]!));
  const filtered = await (await fetch(`${url}/api/runs/${run.runId}/events?after=${events[1].eventId}`)).json();
  assert.deepEqual(filtered.events.map((event: z.infer<typeof EventSchema>) => event.type), ['run.planning', 'run.running', 'candidate.checking', 'candidate.reviewable', 'run.completed', 'revision.accepted']);
  const completedRetry = await post(url, input);
  assert.equal(completedRetry.status, 200);
  assert.equal((await completedRetry.json()).run.runId, run.runId);
  assert.equal(calls, 1);
  const conflict = await post(url, { ...input, instruction: 'Different instruction.' });
  assert.equal(conflict.status, 409);
});

test('mismatched tool revisions fail without promoting a design or importing artifact bytes', async () => {
  const { directory, store, url } = await listen(selected(async (input) => ({
    ...await syntheticTool(input), outputRevisionId: 'wrong_revision',
  })));
  const accepted = await (await post(url, request('mismatched_result'))).json();
  const failed = await terminal(url, accepted.run.runId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'EXECUTION_FAILED');
  assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).status, 'failed');
  assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).artifacts.length, 0);
  assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).checks.length, 0);
  assert.equal(store.getDesign()?.acceptedRevisionId, null);
  assert.deepEqual(await importedFiles(directory), []);
});

test('a timed-out tool result arriving later cannot promote state or import artifacts', { timeout: 5000 }, async () => {
  const { directory, store } = await setup();
  const entered = deferred();
  const release = deferred();
  const settled = deferred();
  let signal: AbortSignal | undefined;
  const tool: ToolAdapter = async (input) => {
    signal = input.signal;
    const output = await syntheticTool(input);
    entered.resolve();
    await release.promise;
    settled.resolve();
    return output;
  };
  const executor = new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool), 200);
  const run = (await store.enqueueRun(request('timeout_tool'))).run;
  const execution = executor.execute(run.runId);
  await entered.promise;
  await execution;
  const failed = store.getRun(run.runId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'RUN_TIMEOUT');
  assert.equal(signal?.aborted, true);
  const eventsAtFailure = store.getEvents(run.runId);
  release.resolve();
  await settled.promise;
  await nextTurn();
  assert.deepEqual(store.getEvents(run.runId), eventsAtFailure);
  assert.equal(store.getDesign()?.acceptedRevisionId, null);
  assert.deepEqual(store.getCandidate(run.candidateRevisionIds[0]!).artifacts, []);
  assert.deepEqual(await importedFiles(directory), []);
});

test('unsupported planner operations and out-of-range parameters never dispatch the tool', async () => {
  for (const proposed of [{ name: 'unsupported_edit', parameters: { lengthMm: 36 } }, { ...operation, parameters: { lengthMm: 1000 } }]) {
    const { directory, store } = await setup();
    let calls = 0;
    const selectedOperation = selected(async (input) => { calls += 1; return syntheticTool(input); });
    selectedOperation.planner.propose = async () => ({ kind: 'numeric_operation', operation: proposed }) as ProviderProposal;
    const executor = new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selectedOperation);
    const run = (await store.enqueueRun(request(`unsupported_${directories.length}`))).run;
    await executor.execute(run.runId);
    assert.equal(calls, 0);
    assert.equal(store.getRun(run.runId).status, 'failed');
    assert.equal(store.getRun(run.runId).error?.code, 'EXECUTION_FAILED');
    assert.equal(store.getDesign()?.acceptedRevisionId, null);
    assert.deepEqual(await importedFiles(directory), []);
  }
});

test('artifact paths outside a run output directory and symlink files are rejected', async () => {
  for (const mode of ['outside', 'symlink'] as const) {
    const { directory, store } = await setup();
    const tool: ToolAdapter = async (input) => {
      if (mode === 'outside') {
        const outside = path.join(directory, 'outside.json');
        await writeFile(outside, testBytes);
        return result(input, outside);
      }
      const target = path.join(input.outputDir, 'target.json');
      await writeFile(target, testBytes);
      await symlink(target, path.join(input.outputDir, 'linked.json'));
      return result(input, 'linked.json');
    };
    const executor = new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool));
    const run = (await store.enqueueRun(request(`rejected_${mode}`))).run;
    await executor.execute(run.runId);
    assert.equal(store.getRun(run.runId).status, 'failed');
    assert.equal(store.getRun(run.runId).error?.code, 'EXECUTION_FAILED');
    assert.deepEqual(store.getCandidate(run.candidateRevisionIds[0]!).artifacts, []);
    assert.equal(store.getDesign()?.acceptedRevisionId, null);
    assert.deepEqual(await importedFiles(directory), []);
  }
});

test('a timeout during artifact import leaves no stored artifacts after the late import settles', { timeout: 5000 }, async () => {
  const { directory, store } = await setup();
  const entered = deferred();
  const release = deferred();
  const settled = deferred();
  class DelayedArtifactStore extends ArtifactStore {
    override async import(...args: Parameters<ArtifactStore['import']>) {
      entered.resolve();
      await release.promise;
      try { return await super.import(...args); }
      finally { settled.resolve(); }
    }
  }
  const executor = new Executor(store, new DelayedArtifactStore(path.join(directory, 'artifacts')), directory, selected(), 200);
  const run = (await store.enqueueRun(request('timeout_import'))).run;
  const execution = executor.execute(run.runId);
  await entered.promise;
  await execution;
  assert.equal(store.getRun(run.runId).error?.code, 'RUN_TIMEOUT');
  release.resolve();
  await settled.promise;
  await nextTurn();
  assert.equal(store.getDesign()?.acceptedRevisionId, null);
  assert.deepEqual(store.getCandidate(run.candidateRevisionIds[0]!).artifacts, []);
  assert.deepEqual(await importedFiles(directory), []);
});

test('mutating the tool input cannot replace the validated operation or promote its artifacts', async () => {
  const { directory, store } = await setup();
  let attemptedHeight: number | undefined;
  const tool: ToolAdapter = async (input) => {
    assert.equal(input.proposal.kind, 'numeric_operation');
    if (input.proposal.kind === 'numeric_operation') { input.proposal.operation.parameters.lengthMm = 1000; attemptedHeight = input.proposal.operation.parameters.lengthMm; }
    return syntheticTool(input);
  };
  const run = (await store.enqueueRun(request('mutated_operation'))).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool)).execute(run.runId);
  const failed = store.getRun(run.runId);
  assert.equal(attemptedHeight, 1000);
  assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).requirements.setup.dimensions.lengthMm, 36);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'EXECUTION_FAILED');
  assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).status, 'failed');
  assert.equal(store.getDesign()?.acceptedRevisionId, null);
  assert.deepEqual(store.getCandidate(failed.candidateRevisionIds[0]!).artifacts, []);
  assert.deepEqual(await importedFiles(directory), []);
});

for (const checkCase of ['duplicate', 'empty'] as const) {
  test(`${checkCase} check evidence is rejected before importing artifact files`, async () => {
    const { directory, store } = await setup();
    const tool: ToolAdapter = async (input) => {
      const output = await syntheticTool(input);
      output.checks = checkCase === 'empty' ? [] : [output.checks[0]!, structuredClone(output.checks[0]!)];
      return output;
    };
    const run = (await store.enqueueRun(request(`${checkCase}_checks`))).run;
    await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool)).execute(run.runId);
    const failed = store.getRun(run.runId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.code, 'EXECUTION_FAILED');
    assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).status, 'failed');
    assert.deepEqual(store.getCandidate(failed.candidateRevisionIds[0]!).checks, []);
    assert.deepEqual(store.getCandidate(failed.candidateRevisionIds[0]!).artifacts, []);
    assert.equal(store.getDesign()?.acceptedRevisionId, null);
    assert.deepEqual(await importedFiles(directory), []);
  });
}

test('a rejected completion discards files already imported for that run', async () => {
  const { directory } = await setup();
  let importedBeforeRejection = 0;
  class CompletionRejectingStore extends RunStore {
    override async completeCandidate(...args: Parameters<RunStore['completeCandidate']>): Promise<Candidate> {
      importedBeforeRejection = args[0].artifacts.length;
      throw new Error('Synthetic completion rejection');
    }
  }
  const store = new CompletionRejectingStore(directory, design, requirements);
  const run = (await store.enqueueRun(request('completion_rejected'))).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected()).execute(run.runId);
  assert.equal(importedBeforeRejection, 4);
  assert.equal(store.getRun(run.runId).status, 'failed');
  assert.deepEqual(store.getCandidate(run.candidateRevisionIds[0]!).artifacts, []);
  assert.equal(store.getDesign()?.acceptedRevisionId, null);
  assert.deepEqual(await importedFiles(directory), []);
});

test('fixture tool results cannot complete live requests or import their artifacts', async () => {
  const { directory, store } = await setup();
  const tool: ToolAdapter = async (input) => ({ ...await syntheticTool(input), executionMode: 'fixture' });
  const run = (await store.enqueueRun(request('fixture_tool_result'))).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool)).execute(run.runId);
  const failed = store.getRun(run.runId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'EXECUTION_FAILED');
  assert.equal(store.getCandidate(failed.candidateRevisionIds[0]!).status, 'failed');
  assert.deepEqual(store.getCandidate(failed.candidateRevisionIds[0]!).checks, []);
  assert.deepEqual(store.getCandidate(failed.candidateRevisionIds[0]!).artifacts, []);
  assert.equal(store.getDesign()?.acceptedRevisionId, null);
  assert.deepEqual(await importedFiles(directory), []);
});

test('typed tool failures retain their safe code, message, and retry status over HTTP', async () => {
  for (const code of ['TOOL_UNAVAILABLE', 'EXPORT_FAILED'] as const) {
    const error = new ToolExecutionError(code);
    const { directory, store, url } = await listen(selected(async () => { throw error; }));
    const accepted = await post(url, request(`typed_${code}`));
    assert.equal(accepted.status, 202);
    const run = await terminal(url, (await accepted.json()).run.runId);
    assert.equal(run.status, 'failed');
    assert.deepEqual(run.error, { code, message: error.message, retryable: code === 'TOOL_UNAVAILABLE' });
    assert.equal(store.getCandidate(run.candidateRevisionIds[0]!).status, 'failed');
    assert.equal(store.getDesign()?.acceptedRevisionId, null);
    assert.deepEqual(store.getCandidate(run.candidateRevisionIds[0]!).artifacts, []);
    assert.deepEqual(await importedFiles(directory), []);
  }
});

test('completed internal state can be accepted and exported over HTTP with adapters unavailable, then becomes historical on confirmed update', async () => {
  const { directory, store } = await setup();
  const run = (await store.enqueueRun(request('internal_completed'))).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected()).execute(run.runId);
  assert.equal(store.getRun(run.runId).status, 'completed');
  const candidate = store.getCandidate(run.candidateRevisionIds[0]!);
  const server = createApp(store, directory, null);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
  const send = (route: string, method: string, body: unknown) => fetch(url + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const retryOffline = await post(url, request('internal_completed'));
  assert.equal(retryOffline.status, 200); assert.equal((await retryOffline.json()).run.runId, run.runId);
  assert.equal((await post(url, { ...request('internal_completed'), instruction: 'Changed payload' })).status, 409);
  const bootstrap = BootstrapSchema.parse(await (await fetch(url + '/api/bootstrap')).json());
  assert.equal(bootstrap.scopeStatus, 'selected'); assert.equal(bootstrap.executionMode, 'unavailable'); assert.match(bootstrap.unavailableReason!, /unavailable/);
  const a = { contractVersion: CONTRACT_VERSION, requestId: 'accept_offline', designId: design.designId, candidateRevisionId: candidate.revisionId,
    requirementsVersion: 1, expectedStateVersion: store.getDesign()!.stateVersion, expectedAcceptedRevisionId: null,
    registryHash: candidate.registryHash, setupHash: candidate.setupHash, geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash, userActionId: 'accept_action' };
  assert.equal((await send('/api/revisions/wrong/accept', 'POST', a)).status, 409);
  const response = await send(`/api/revisions/${candidate.revisionId}/accept`, 'POST', a); assert.equal(response.status, 200);
  const { acceptance, manifest } = await response.json();
  for (const [kind, id, expected] of [['candidates', candidate.revisionId, store.getCandidate(candidate.revisionId)], ['acceptances', acceptance.acceptanceId, acceptance], ['manifests', manifest.manifestId, manifest]] as const) {
    assert.deepEqual(await (await fetch(`${url}/api/${kind}/${id}`)).json(), expected);
  }
  const x = { contractVersion: CONTRACT_VERSION, requestId: 'export_offline', acceptanceId: acceptance.acceptanceId, manifestId: manifest.manifestId, manifestHash: manifest.manifestHash };
  const exportResponse = await send(`/api/revisions/${candidate.revisionId}/export`, 'POST', x); assert.equal(exportResponse.status, 200);
  assert.deepEqual((await exportResponse.json()).manifest, manifest);
  for (const artifact of candidate.artifacts) {
    const downloaded = await fetch(url + artifact.href); assert.equal(downloaded.headers.get('X-WorldKinetics-Applicability'), 'current');
    assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'), artifact.sha256);
  }
  const u = { contractVersion: CONTRACT_VERSION, requestId: 'confirm_30', expectedStateVersion: store.getDesign()!.stateVersion,
    expectedRequirementsVersion: 1, setupId: 'resize_centered_v1', confirmedIntent: { lengthMm: 30 }, userActionId: 'confirm_action' };
  assert.equal((await send('/api/designs/wrong/requirements', 'PATCH', u)).status, 409);
  assert.equal((await send(`/api/designs/${design.designId}/requirements`, 'PATCH', u)).status, 200);
  assert.equal(store.getRequirements()!.setup.dimensions.lengthMm, 30); assert.equal(store.getDesign()!.acceptedRequirementsMatch, false);
  assert.equal((await send(`/api/revisions/${candidate.revisionId}/export`, 'POST', x)).status, 409);
  assert.equal((await fetch(url + candidate.artifacts[0]!.href)).headers.get('X-WorldKinetics-Applicability'), 'historical');
  const ambiguous = await fetch(`${url}/api/designs/${design.designId}/requirements`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"requestId":"a","requestId":"b"}' });
  assert.equal(ambiguous.status, 400);
  const oversized = await fetch(url + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'a'.repeat(8192) }) });
  assert.equal(oversized.status, 413);
});
