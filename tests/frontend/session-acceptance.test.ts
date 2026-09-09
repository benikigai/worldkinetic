// OUTSIDE_WRAPPER: synthetic session transport tests, no credentials or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClient, createWorkspaceTransport } from '../../src/client/workspace/session.js';
import { CONTRACT_VERSION } from '../../src/shared/contracts-v2.js';
const status = (workspaceId = 'workspace_test') => ({ contractVersion: CONTRACT_VERSION, accessMode: 'invite', authenticated: true,
  runsPerSession: 3, runsPerLaunch: 3, workspaceId, runsRemaining: 3, launchRunsRemaining: 3,
  busy: false, expiresAt: new Date(Date.now() + 3600000).toISOString(), canStartNewDesign: true });
const wire = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('only loopback session404 enables older local server compatibility', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const client = createSessionClient(async () => new Response('', { status: 404 }), host);
    assert.equal(await client.status(), null);
  }
  for (const host of ['worldkinetics.app', 'localhost.attacker.example', '127.0.0.1.example']) {
    const client = createSessionClient(async () => new Response('', { status: 404 }), host);
    await assert.rejects(client.status(), /unavailable/);
  }
});
test('503, auth denial and malformed data never create a session', async () => {
  for (const response of [new Response('', { status: 503 }), new Response('', { status: 403 }), wire({ authenticated: true }), wire({ ...status(), expiresAt: '2020-01-01T00:00:00Z' })]) {
    const client = createSessionClient(async () => response, 'worldkinetics.app');
    await assert.rejects(client.status());
  }
});
test('login preserves the access code and uses only credentialed same-origin routes', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = createSessionClient(async (path, init) => { calls.push({ path: String(path), init }); return wire(status()); }, 'worldkinetics.app');
  await client.login('test-code');
  assert.equal(calls[0].path, '/api/session');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { accessCode: 'test-code' });
  assert.equal(calls[0].init?.credentials, 'same-origin'); assert.equal(calls[0].init?.redirect, 'error'); assert.equal(calls[0].init?.cache, 'no-store');
  await client.logout(); assert.equal(calls[1].init?.method, 'DELETE');
});
test('explicit uncertain fresh-design retry keeps the same request identity and budget is not reset by client', async () => {
  const bodies: any[] = []; let lose = true;
  const client = createSessionClient(async (_path, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (lose) { lose = false; throw new Error('connection lost'); }
    return wire({ ...status('workspace_next'), runsRemaining: 2 });
  }, 'worldkinetics.app');
  await assert.rejects(client.newDesign('workspace_test'));
  const next = await client.newDesign('workspace_test');
  assert.deepEqual(bodies[0], bodies[1]); assert.equal(bodies.length, 2);
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['contractVersion', 'expectedWorkspaceId', 'requestId']);
  assert.ok(next.authenticated); if (next.authenticated) assert.equal(next.runsRemaining, 2);
});
test('fresh design requires a changed authenticated workspace and never silently retries', async () => {
  let calls = 0;
  const client = createSessionClient(async () => { calls++; return wire(status()); }, 'worldkinetics.app');
  await assert.rejects(client.newDesign('workspace_test'), /not confirmed/); assert.equal(calls, 1);
  await assert.rejects(client.newDesign('workspace_other'), /Check access/); assert.equal(calls, 1);
});
test('oversized session responses are rejected', async () => {
  const client = createSessionClient(async () => new Response('x'.repeat(20000), { headers: { 'Content-Type': 'application/json' } }), 'worldkinetics.app');
  await assert.rejects(client.status(), /verified/);
});


test('stale controller mutations and retries remain bound to the original workspace', async () => {
  const headers: Headers[] = [];
  const transport = createWorkspaceTransport(async (_input, init) => { headers.push(new Headers(init?.headers)); return wire({}); });
  assert.throws(() => transport.fetch('/api/runs', { method: 'POST' }), /not been verified/);
  transport.bind('workspace_original');
  await transport.fetch('/api/runs', { method: 'POST', headers: { 'X-WorldKinetics-Workspace': 'forged' } });
  assert.throws(() => transport.bind('workspace_new'), /Reload/);
  await transport.fetch('/api/runs', { method: 'POST' });
  assert.deepEqual(headers.map(h => h.get('X-WorldKinetics-Workspace')), ['workspace_original', 'workspace_original']);
  const fresh = createWorkspaceTransport(async (_input, init) => { headers.push(new Headers(init?.headers)); return wire({}); });
  fresh.bind('workspace_new'); await fresh.fetch('/api/designs/handle/requirements', { method: 'PATCH' });
  assert.equal(headers.at(-1)?.get('X-WorldKinetics-Workspace'), 'workspace_new');
});
test('legacy loopback controller omits workspace mutation binding', async () => {
  const transport = createWorkspaceTransport(async (_input, init) => { assert.equal(new Headers(init?.headers).get('X-WorldKinetics-Workspace'), null); return wire({}); });
  transport.bind(null); await transport.fetch('/api/runs', { method: 'POST', headers: { 'X-WorldKinetics-Workspace': 'forged' } });
});


test('operator allowance is accepted only with the verified server role and bounded remaining counts', async () => {
  const operator = { ...status(), accessRole: 'operator', runsPerSession: 30, runsPerLaunch: 30, runsRemaining: 29, launchRunsRemaining: 29 };
  const client = createSessionClient(async () => wire(operator), 'worldkinetics.app');
  const result = await client.status();
  assert.ok(result?.authenticated);
  if (result?.authenticated) { assert.equal(result.accessRole, 'operator'); assert.equal(result.runsRemaining, 29); }
  for (const invalid of [{ ...operator, accessRole: undefined }, { ...operator, runsRemaining: 31 }]) {
    await assert.rejects(createSessionClient(async () => wire(invalid), 'worldkinetics.app').status());
  }
});
