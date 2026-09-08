import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { afterEach, test } from 'node:test';
import { z } from 'zod';
import {
  BootstrapSchema, CONTRACT_VERSION, EventSchema, RunSchema, ToolExecutionError,
  type Design, type Run, type RunRequest, type ToolAdapter, type ToolInput, type ToolResult,
} from '../../src/shared/contracts.js';
import { createApp } from '../../src/server/app.js';
import { ArtifactStore } from '../../src/server/artifacts.js';
import { Executor, type SelectedOperation } from '../../src/server/execution.js';
import { RunStore } from '../../src/server/store.js';

// These adapters exercise transport and storage using JSON files. They perform no CAD operation.
const design: Design = { designId: 'synthetic_test_design', label: 'Synthetic backend test', currentRevisionId: 'synthetic_initial', latestRunId: null, units: 'mm' };
const operation = { name: 'synthetic_test_edit', parameters: { height: 20 } };
const testBytes = Buffer.from('{"syntheticBackendTest":true,"height":20}\n');
const directories: string[] = [];
const servers: Server[] = [];

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
  return { contractVersion: CONTRACT_VERSION, requestId, designId: design.designId, inputRevisionId: design.currentRevisionId, units: 'mm', instruction: 'Produce the synthetic backend test file.' };
}

function result(input: ToolInput, filePath = 'synthetic.json'): ToolResult {
  return {
    contractVersion: CONTRACT_VERSION, runId: input.runId, designId: input.designId,
    inputRevisionId: input.inputRevisionId, outputRevisionId: input.outputRevisionId,
    units: 'mm', executionMode: 'live', operation: input.operation,
    checks: [{ checkId: 'synthetic_bytes', label: 'Synthetic JSON fixture content', revisionId: input.outputRevisionId, state: 'passed', method: 'Injected backend test adapter', details: 'No CAD or geometry check was performed.', measuredValue: null, expected: null, units: null }],
    artifacts: [{ path: filePath, kind: 'editable', mediaType: 'application/json', fileName: 'synthetic.json' }],
  };
}

const syntheticTool: ToolAdapter = async (input) => {
  await writeFile(path.join(input.outputDir, 'synthetic.json'), testBytes);
  return result(input);
};

function selected(tool: ToolAdapter = syntheticTool): SelectedOperation {
  return {
    name: operation.name,
    parameters: z.object({ height: z.number().min(1).max(100) }).strict(),
    planner: {
      identity: { name: 'injected-backend-test-planner', requestedModel: 'synthetic-test-double', reportedModel: 'synthetic-test-double' },
      propose: async () => structuredClone(operation),
    },
    tool,
  };
}

async function setup(initialDesign: Design | null = design) {
  const directory = await mkdtemp(path.join(tmpdir(), 'worldkinetics-api-test-'));
  directories.push(directory);
  return { directory, store: new RunStore(directory, initialDesign) };
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
    if (['succeeded', 'failed', 'superseded'].includes(run.status)) return run;
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
  assert.equal((await unavailable.json()).error.code, 'SCOPE_NOT_SELECTED');
  assert.equal(store.listRuns().length, 0);
  const fixtureResponse = await fetch(`${url}/api/fixtures/run`);
  assert.equal(fixtureResponse.status, 200);
  const fixture = RunSchema.parse(await fixtureResponse.json());
  assert.equal(fixture.executionMode, 'fixture');
  assert.equal(fixture.evidenceApplicability, 'fixture');
  const fixtureEventsResponse = await fetch(`${url}/api/fixtures/events`);
  const fixtureEventsBody = await fixtureEventsResponse.json();
  const fixtureEvents = z.array(EventSchema).parse(Array.isArray(fixtureEventsBody) ? fixtureEventsBody : fixtureEventsBody.events);
  assert.ok(fixtureEvents.length > 0);
  assert.ok(fixtureEvents.every((event) => event.run.evidenceApplicability === 'fixture'));
  const fixtureArtifact = fixture.artifacts[0]!;
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
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const contentType = await fetch(`${url}/api/runs`, { method: 'POST', body: '{}' });
  assert.equal(contentType.status, 415);
  const origin = await fetch(`${url}/api/bootstrap`, { headers: { Origin: 'http://unrelated.invalid' } });
  assert.equal(origin.status, 403);
  assert.equal(store.listRuns().length, 0);
  const missing = await fetch(`${url}/api/runs/missing_run`);
  assert.equal(missing.status, 404);
  const { run } = store.accept(request('cursor_request'));
  const cursor = await fetch(`${url}/api/runs/${run.runId}/events?after=-1`);
  assert.equal(cursor.status, 400);
  assert.equal((await cursor.json()).error.code, 'INVALID_CURSOR');
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
  assert.equal(run.status, 'succeeded');
  assert.equal(run.evidenceApplicability, 'current');
  assert.equal(run.checks[0]?.revisionId, run.outputRevisionId);
  assert.equal(store.getDesign()?.currentRevisionId, run.outputRevisionId);
  const artifact = run.artifacts[0]!;
  assert.equal(artifact.runId, run.runId);
  assert.equal(artifact.revisionId, run.outputRevisionId);
  const download = await fetch(`${url}${artifact.href}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Length'), String(testBytes.length));
  assert.equal(download.headers.get('Content-Type'), 'application/json');
  assert.equal(download.headers.get('Content-Disposition'), 'attachment; filename="synthetic.json"');
  assert.equal(download.headers.get('X-WorldKinetics-Revision'), run.outputRevisionId);
  assert.equal(download.headers.get('X-WorldKinetics-Execution'), 'live');
  const downloaded = Buffer.from(await download.arrayBuffer());
  assert.deepEqual(downloaded, testBytes);
  assert.equal(artifact.bytes, downloaded.length);
  assert.equal(artifact.sha256, createHash('sha256').update(downloaded).digest('hex'));
  const events = (await (await fetch(`${url}/api/runs/${run.runId}/events`)).json()).events.map((event: unknown) => EventSchema.parse(event));
  assert.deepEqual(events.map((event: z.infer<typeof EventSchema>) => event.type), ['run.accepted', 'run.planning', 'run.running', 'run.completed']);
  assert.ok(events.every((event: z.infer<typeof EventSchema>) => event.revisionId === run.outputRevisionId));
  const filtered = await (await fetch(`${url}/api/runs/${run.runId}/events?after=${events[1].eventId}`)).json();
  assert.deepEqual(filtered.events.map((event: z.infer<typeof EventSchema>) => event.type), ['run.running', 'run.completed']);
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
  assert.equal(failed.evidenceApplicability, 'unavailable');
  assert.equal(failed.artifacts.length, 0);
  assert.equal(failed.checks.length, 0);
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
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
  const run = store.accept(request('timeout_tool')).run;
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
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.deepEqual(store.getRun(run.runId).artifacts, []);
  assert.deepEqual(await importedFiles(directory), []);
});

test('unsupported planner operations and out-of-range parameters never dispatch the tool', async () => {
  for (const proposed of [{ name: 'unsupported_edit', parameters: { height: 20 } }, { ...operation, parameters: { height: 1000 } }]) {
    const { directory, store } = await setup();
    let calls = 0;
    const selectedOperation = selected(async (input) => { calls += 1; return syntheticTool(input); });
    selectedOperation.planner.propose = async () => proposed;
    const executor = new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selectedOperation);
    const run = store.accept(request(`unsupported_${directories.length}`)).run;
    await executor.execute(run.runId);
    assert.equal(calls, 0);
    assert.equal(store.getRun(run.runId).status, 'failed');
    assert.equal(store.getRun(run.runId).error?.code, proposed.name === operation.name ? 'EXECUTION_FAILED' : 'UNSUPPORTED_OPERATION');
    assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
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
    const run = store.accept(request(`rejected_${mode}`)).run;
    await executor.execute(run.runId);
    assert.equal(store.getRun(run.runId).status, 'failed');
    assert.equal(store.getRun(run.runId).error?.code, 'EXECUTION_FAILED');
    assert.deepEqual(store.getRun(run.runId).artifacts, []);
    assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
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
  const run = store.accept(request('timeout_import')).run;
  const execution = executor.execute(run.runId);
  await entered.promise;
  await execution;
  assert.equal(store.getRun(run.runId).error?.code, 'RUN_TIMEOUT');
  release.resolve();
  await settled.promise;
  await nextTurn();
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.deepEqual(store.getRun(run.runId).artifacts, []);
  assert.deepEqual(await importedFiles(directory), []);
});

test('mutating the tool input cannot replace the validated operation or promote its artifacts', async () => {
  const { directory, store } = await setup();
  let attemptedHeight: number | undefined;
  const tool: ToolAdapter = async (input) => {
    input.operation.parameters.height = 1000;
    attemptedHeight = input.operation.parameters.height;
    return syntheticTool(input);
  };
  const run = store.accept(request('mutated_operation')).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool)).execute(run.runId);
  const failed = store.getRun(run.runId);
  assert.equal(attemptedHeight, 1000);
  assert.equal(failed.operation?.parameters.height, 20);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'EXECUTION_FAILED');
  assert.equal(failed.evidenceApplicability, 'unavailable');
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.deepEqual(failed.artifacts, []);
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
    const run = store.accept(request(`${checkCase}_checks`)).run;
    await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool)).execute(run.runId);
    const failed = store.getRun(run.runId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.code, 'EXECUTION_FAILED');
    assert.equal(failed.evidenceApplicability, 'unavailable');
    assert.deepEqual(failed.checks, []);
    assert.deepEqual(failed.artifacts, []);
    assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
    assert.deepEqual(await importedFiles(directory), []);
  });
}

test('a rejected completion discards files already imported for that run', async () => {
  const { directory } = await setup();
  let importedBeforeRejection = 0;
  class CompletionRejectingStore extends RunStore {
    override complete(...args: Parameters<RunStore['complete']>): Run {
      importedBeforeRejection = args[2].length;
      throw new Error('Synthetic completion rejection');
    }
  }
  const store = new CompletionRejectingStore(directory, design);
  const run = store.accept(request('completion_rejected')).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected()).execute(run.runId);
  assert.equal(importedBeforeRejection, 1);
  assert.equal(store.getRun(run.runId).status, 'failed');
  assert.deepEqual(store.getRun(run.runId).artifacts, []);
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
  assert.deepEqual(await importedFiles(directory), []);
});

test('fixture tool results cannot complete live requests or import their artifacts', async () => {
  const { directory, store } = await setup();
  const tool: ToolAdapter = async (input) => ({ ...await syntheticTool(input), executionMode: 'fixture' });
  const run = store.accept(request('fixture_tool_result')).run;
  await new Executor(store, new ArtifactStore(path.join(directory, 'artifacts')), directory, selected(tool)).execute(run.runId);
  const failed = store.getRun(run.runId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'TOOL_NOT_LIVE');
  assert.equal(failed.evidenceApplicability, 'unavailable');
  assert.deepEqual(failed.checks, []);
  assert.deepEqual(failed.artifacts, []);
  assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
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
    assert.equal(run.evidenceApplicability, 'unavailable');
    assert.equal(store.getDesign()?.currentRevisionId, design.currentRevisionId);
    assert.deepEqual(run.artifacts, []);
    assert.deepEqual(await importedFiles(directory), []);
  }
});
