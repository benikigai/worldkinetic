import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { CodexAstraPlanner } from '../../src/server/astra.js';
import { ExecutionError } from '../../src/server/errors.js';
import { CONTRACT_VERSION, type Run } from '../../src/shared/contracts.js';

const directories: string[] = [];
const operation = { name: 'synthetic_edit', parameters: { height: 20 } };
const successfulEvents = [
  { type: 'thread.started', thread_id: 'synthetic_thread' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(operation) } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
];
const run: Run = {
  contractVersion: CONTRACT_VERSION, runId: 'synthetic_run', requestId: 'synthetic_request',
  designId: 'synthetic_design', inputRevisionId: 'synthetic_initial', outputRevisionId: 'synthetic_output',
  units: 'mm', instruction: 'Set height to 20 mm.', status: 'planning', executionMode: 'live',
  createdAt: '2026-09-08T18:00:00Z', updatedAt: '2026-09-08T18:00:00Z', operation: null,
  checks: [], artifacts: [], evidenceApplicability: 'pending', error: null, provider: null,
};

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function setup(body: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'worldkinetics-astra-test-'));
  directories.push(directory);
  // Spaces and a shell metacharacter prove this is spawned as a literal executable path.
  const binary = path.join(directory, 'fake codex; literal.cjs');
  await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst args = process.argv.slice(2);\nconst output = args[args.indexOf('-o') + 1];\nlet prompt = '';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', chunk => prompt += chunk);\nprocess.stdin.on('end', () => {\n${body}\n});\n`);
  await chmod(binary, 0o700);
  const providerDir = path.join(directory, 'runs', run.runId, 'provider');
  const planner = new CodexAstraPlanner({
    runtimeDir: directory, operationName: operation.name,
    parameters: z.object({ height: z.number().min(1).max(100) }).strict(),
    context: 'Synthetic test only. No CAD operation.', binary,
  });
  return { directory, providerDir, planner };
}

function emit(events: unknown[] = successfulEvents, output: string | null = JSON.stringify(operation)) {
  return `${output === null ? '' : `fs.writeFileSync(output, ${JSON.stringify(output)});`}\nprocess.stdout.write(${JSON.stringify(events.map(event => JSON.stringify(event)).join('\n') + '\n')});`;
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ExecutionError && error.code === code;
}

async function exists(file: string) {
  try { await readFile(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function waitFor(file: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await exists(file)) return;
    await delay(10);
  }
  throw new Error('Fake provider did not start within the test deadline.');
}

test('provider is spawned literally with bounded flags and request text only on stdin', async () => {
  const { providerDir, planner } = await setup(`fs.writeFileSync(path.join(process.cwd(), 'captured.json'), JSON.stringify({ args, prompt }));\n${emit()}`);
  const instruction = 'Set height to 20 mm; $(literal-design-text) `literal-design-text`';
  assert.deepEqual(await planner.propose({ ...run, instruction }, AbortSignal.timeout(3000)), operation);
  const captured = JSON.parse(await readFile(path.join(providerDir, 'captured.json'), 'utf8'));
  assert.ok(captured.prompt.includes(JSON.stringify(instruction)));
  assert.equal(captured.args.includes(instruction), false);
  for (const flag of ['--ignore-user-config', '--ephemeral', '--strict-config', '--json', '--output-schema']) assert.ok(captured.args.includes(flag));
  assert.equal(captured.args[captured.args.indexOf('--sandbox') + 1], 'read-only');
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'memories', 'multi_agent', 'browser_use', 'computer_use', 'image_generation']) {
    const index = captured.args.indexOf(feature);
    assert.ok(index > 0 && captured.args[index - 1] === '--disable', `${feature} must remain disabled`);
  }
});

test('provider does not inherit unrelated server environment variables', async () => {
  const key = 'WORLDKINETICS_TEST_UNRELATED_SECRET';
  const previous = process.env[key];
  process.env[key] = 'synthetic-private-server-value';
  try {
    const { providerDir, planner } = await setup(`fs.writeFileSync(path.join(process.cwd(), 'environment.json'), JSON.stringify({ leaked: Object.hasOwn(process.env, ${JSON.stringify(key)}) }));\n${emit()}`);
    await planner.propose(run, AbortSignal.timeout(3000));
    assert.equal(JSON.parse(await readFile(path.join(providerDir, 'environment.json'), 'utf8')).leaked, false);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('already-aborted requests never start the provider', async () => {
  const { providerDir, planner } = await setup(`fs.writeFileSync(path.join(process.cwd(), 'started'), 'yes');\n${emit()}`);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(planner.propose(run, controller.signal), hasCode('ASTRA_CANCELLED'));
  assert.equal(await exists(path.join(providerDir, 'started')), false);
});

test('cancellation stops the provider and its child process before either can keep writing', { timeout: 5000 }, async () => {
  const { providerDir, planner } = await setup(`
const { spawn } = require('node:child_process');
const heartbeat = path.join(process.cwd(), 'heartbeat');
const child = spawn(process.execPath, ['-e', "const fs = require('node:fs'); setInterval(() => fs.appendFileSync(process.argv[1], '.'), 15);", heartbeat], { stdio: 'ignore' });
fs.writeFileSync(path.join(process.cwd(), 'child-pid'), String(child.pid));
setInterval(() => {}, 1000);
`);
  const controller = new AbortController();
  const pending = planner.propose(run, controller.signal);
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof ExecutionError && error.retryable);
  let childPid: number | undefined;
  try {
    await waitFor(path.join(providerDir, 'heartbeat'));
    childPid = Number(await readFile(path.join(providerDir, 'child-pid'), 'utf8'));
    controller.abort();
    await rejected;
    const stopped = await readFile(path.join(providerDir, 'heartbeat'), 'utf8');
    await delay(100);
    assert.equal(await readFile(path.join(providerDir, 'heartbeat'), 'utf8'), stopped);
    assert.equal(await exists(path.join(providerDir, 'receipt.json')), false);
  } finally {
    controller.abort();
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch { /* Already stopped by the adapter. */ } }
    await rejected;
  }
});

for (const [name, events] of [
  ['missing completed turn', successfulEvents.slice(0, -1)],
  ['command execution', [...successfulEvents.slice(0, -1), { type: 'item.completed', item: { type: 'command_execution', command: 'synthetic-only' } }, successfulEvents.at(-1)]],
  ['MCP tool execution', [...successfulEvents.slice(0, -1), { type: 'item.completed', item: { type: 'mcp_tool_call' } }, successfulEvents.at(-1)]],
  ['file change', [...successfulEvents.slice(0, -1), { type: 'item.completed', item: { type: 'file_change' } }, successfulEvents.at(-1)]],
  ['failed turn', [...successfulEvents, { type: 'turn.failed', error: { message: 'synthetic failure' } }]],
  ['unfinished later turn', [...successfulEvents, { type: 'turn.started' }]],
  ['top-level runtime error', [...successfulEvents, { type: 'error', message: 'synthetic failure' }]],
] as const) {
  test(`provider rejects ${name}`, async () => {
    const { providerDir, planner } = await setup(emit([...events]));
    await assert.rejects(planner.propose(run, AbortSignal.timeout(3000)), hasCode('ASTRA_INVALID_RESPONSE'));
    assert.equal(await exists(path.join(providerDir, 'receipt.json')), false);
  });
}

test('provider rejects malformed event JSON', async () => {
  const { planner } = await setup(`${emit()}\nprocess.stdout.write('{malformed\\n');`);
  await assert.rejects(planner.propose(run, AbortSignal.timeout(3000)), hasCode('ASTRA_INVALID_RESPONSE'));
});

for (const [name, output] of [
  ['malformed output JSON', '{malformed'],
  ['wrong operation', JSON.stringify({ name: 'unapproved_edit', parameters: { height: 20 } })],
  ['out-of-range parameter', JSON.stringify({ name: operation.name, parameters: { height: 1000 } })],
  ['unexpected parameter', JSON.stringify({ ...operation, parameters: { height: 20, secret: 1 } })],
  ['missing output file', null],
] as const) {
  test(`provider rejects ${name}`, async () => {
    const { planner } = await setup(emit(successfulEvents, output));
    await assert.rejects(planner.propose(run, AbortSignal.timeout(3000)), hasCode('ASTRA_INVALID_OPERATION'));
  });
}

test('completed turn cannot reuse an output file from an earlier provider attempt', async () => {
  const { providerDir, planner } = await setup(emit(successfulEvents, null));
  await mkdir(providerDir, { recursive: true });
  await writeFile(path.join(providerDir, 'response.json'), JSON.stringify(operation));
  await assert.rejects(planner.propose(run, AbortSignal.timeout(3000)), (error: unknown) => error instanceof ExecutionError);
});

test('stderr secrets are absent from a failed provider error and public receipt', async () => {
  const secret = 'synthetic-private-stderr-value';
  const { providerDir, planner } = await setup(`process.stderr.write(${JSON.stringify(secret)}); process.exitCode = 2;`);
  await assert.rejects(planner.propose(run, AbortSignal.timeout(3000)), (error: unknown) => {
    assert.ok(error instanceof ExecutionError);
    assert.equal(error.code, 'ASTRA_FAILED');
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
  assert.equal(await exists(path.join(providerDir, 'receipt.json')), false);
});

test('stderr secrets are absent from a successful provider receipt', async () => {
  const secret = 'synthetic-private-stderr-value';
  const { providerDir, planner } = await setup(`process.stderr.write(${JSON.stringify(secret)});\n${emit()}`);
  assert.deepEqual(await planner.propose(run, AbortSignal.timeout(3000)), operation);
  assert.equal((await readFile(path.join(providerDir, 'receipt.json'), 'utf8')).includes(secret), false);
});

test('excessive provider output is stopped and rejected', async () => {
  const { planner } = await setup(`process.stdout.write('x'.repeat(1024 * 1024 + 1)); setInterval(() => {}, 1000);`);
  await assert.rejects(planner.propose(run, AbortSignal.timeout(3000)), hasCode('ASTRA_FAILED'));
});
