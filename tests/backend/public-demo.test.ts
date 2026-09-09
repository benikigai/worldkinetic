// OUTSIDE_WRAPPER. Synthetic provider/CAD bytes exercise auth, authority and transport, not geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicDemo, type PublicDemoOptions } from '../../src/server/public-demo.js';
import * as c from '../../src/shared/contracts.js';
import { requirementIdentity } from '../../src/server/store.js';
import { verifyAcceptanceResponse } from '../../src/shared/transport-v2.js';
import { createSessionClient, createWorkspaceTransport } from '../../src/client/workspace/session.js';

const origin = 'https://worldkinetics.app';
const upstream = 'synthetic-upstream-key-not-a-secret-123';
const invite = 'synthetic-invite-not-a-secret';
const input = (requestId: string): c.RunRequest => ({ contractVersion: c.CONTRACT_VERSION, requestId,
  designId: 'handle', inputRevisionId: 'handle_mount_reference_v1', requirementsVersion: 1,
  setupId: 'handle_initial_v1', units: 'mm', instruction: 'Synthetic custom curved grip request' });
const providerResponse = () => new Response(JSON.stringify({ id: 'resp_synthetic', object: 'response', model: 'gpt-6-astra', status: 'completed',
  output: [{ type: 'message', phase: 'final_answer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', annotations: [],
    text: JSON.stringify({ kind: 'python_source', source: '# synthetic only', changeSummary: 'Synthetic HTTP test' }) }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
async function options(): Promise<PublicDemoOptions> {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'wk-public-test-'));
  const referenceDir = path.join(runtimeDir, 'inputs'); await mkdir(referenceDir);
  const referenceFiles = { stepPath: path.join(referenceDir, 'reference.step'), previewPath: path.join(referenceDir, 'preview.stl'), datumPath: path.join(referenceDir, 'datums.json') };
  await writeFile(referenceFiles.stepPath, 'SYNTHETIC REFERENCE'); await writeFile(referenceFiles.previewPath, 'SYNTHETIC MESH');
  await writeFile(referenceFiles.datumPath, c.HANDLE_DATUM_CANONICAL_JSON);
  return { runtimeDir, referenceFiles, publicOrigin: origin, upstreamKey: upstream, inviteCode: invite,
    apiKey: 'synthetic-provider-key', fetchImpl: async () => { throw Error('Synthetic provider failure'); } };
}
async function start(overrides: Partial<PublicDemoOptions> = {}) {
  const app = await createPublicDemo({ ...await options(), ...overrides });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const bindings = new Map<string, string>();
  const bind = (cookie: string, workspaceId: string) => { bindings.set(cookie, workspaceId); };
  const call = (route: string, cookie = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(base + route, {
    method, headers: { 'X-WorldKinetics-Upstream-Key': upstream, 'X-WorldKinetics-Client-IP': '192.0.2.10',
      Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', [c.PUBLIC_WORKSPACE_HEADER]: bindings.get(cookie) ?? '', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function login(ip = '192.0.2.10') {
    const response = await call('/api/session', '', 'POST', { accessCode: invite }, { 'X-WorldKinetics-Client-IP': ip });
    assert.equal(response.status, 200); const value = c.SessionStatusSchema.parse(await response.json());
    assert(value.authenticated); const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /^__Host-wk_session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
    bind(cookie.split(';')[0]!, value.workspaceId);
    return { cookie: cookie.split(';')[0]!, status: value };
  }
  async function idle(cookie: string) {
    for (let i = 0; i < 250; i++) {
      const status = c.SessionStatusSchema.parse(await (await call('/api/session', cookie)).json());
      if (status.authenticated && !status.busy) return status;
      await delay(10);
    }
    throw Error('Synthetic job did not settle');
  }
  return { ...app, call, login, idle, base, bind };
}
async function syntheticTool(input: c.ToolInput): Promise<c.ToolResult> {
  assert.equal(input.proposal.kind, 'python_source');
  if (input.proposal.kind !== 'python_source') throw Error('Expected source');
  const source = input.proposal.source, step = 'SYNTHETIC STEP ' + input.attemptId, stl = 'SYNTHETIC MESH ' + input.attemptId;
  await mkdir(input.outputDir, { recursive: true });
  const geometryHash = await c.sha256(step), r = input.requirements;
  const checks = r.requiredChecks.map(id => ({ checkId: id, revisionId: input.outputRevisionId, ...requirementIdentity(r), geometryHash,
    executionMode: 'live' as const, state: 'passed' as const, label: id, method: c.checkDefinition(id, r.registryId).method,
    expected: c.expectedForCheck(r, id), measured: { synthetic: true }, units: c.checkDefinition(id, r.registryId).units, details: 'Synthetic, not geometry evidence.' }));
  const artifacts = [];
  for (const [kind, fileName, mediaType, data] of [['source', 'source.py', 'text/x-python', source], ['editable', 'editable.py', 'text/x-python', source],
    ['export', 'part.step', 'model/step', step], ['preview', 'preview.stl', 'model/stl', stl]] as const) {
    const file = path.join(input.outputDir, fileName); await writeFile(file, data);
    artifacts.push({ kind, fileName, mediaType, path: file, bytes: Buffer.byteLength(data), sha256: await c.sha256(data), executionMode: 'live' as const });
  }
  const result = { contractVersion: c.CONTRACT_VERSION, ...requirementIdentity(r), requirements: r, runId: input.runId, requestId: input.requestId,
    designId: input.designId, inputRevisionId: input.inputRevisionId, outputRevisionId: input.outputRevisionId, attemptId: input.attemptId,
    units: 'mm' as const, executionMode: 'live' as const, status: 'completed' as const, proposal: input.proposal, proposalHash: await c.hashCanonical(input.proposal),
    sourceSha256: await c.sha256(source), engine: { name: 'build123d' as const, version: 'synthetic', imageDigest: 'sha256:' + '1'.repeat(64) },
    geometryHash, checkBundleHash: null as string | null, checks, artifacts, error: null };
  result.checkBundleHash = await c.computeCheckBundleHash({ ...result, revisionId: input.outputRevisionId });
  return result;
}

test('public startup requires secrets and exact HTTPS origin; fixture follows the shared schema', async () => {
  const config = await options();
  for (const change of [{ upstreamKey: '' }, { inviteCode: '' }, { inviteCode: upstream }, { publicOrigin: 'http://localhost' }, { publicOrigin: origin + '/' }]) {
    await assert.rejects(createPublicDemo({ ...config, ...change }));
  }
  const app = await createPublicDemo(config);
  try { await assert.rejects(createPublicDemo(config)); } finally { await app.close(); }
  const fixture = c.SessionStatusSchema.parse(JSON.parse(await readFile(new URL('../../fixtures/api/v2/session.fixture.json', import.meta.url), 'utf8')));
  assert(fixture.authenticated); assert.match(fixture.workspaceId, /fixture_only/);
});

test('origin, proxy secret, cookie and invite checks fail closed without leaking secrets', async () => {
  const app = await start();
  try {
    const anonymous = c.SessionStatusSchema.parse(await (await app.call('/api/session')).json()); assert.equal(anonymous.authenticated, false);
    for (const route of ['/api/bootstrap', '/api/acceptances', '/api/artifacts/guess', '/api/reference']) assert.equal((await app.call(route)).status, 401);
    const rejectedHeaders: Record<string, string>[] = [{ 'X-WorldKinetics-Upstream-Key': '' }, { Origin: 'https://attacker.example' }, { Origin: '' }];
    for (const headers of rejectedHeaders) {
      const response = await app.call('/api/session', '', 'POST', { accessCode: invite }, headers);
      assert.equal(response.status, 403); const text = await response.text(); assert(!text.includes(invite)); assert(!text.includes(upstream));
    }
    assert.equal((await app.call('/api/session', '', 'POST', { accessCode: invite, injected: true })).status, 400);
    const a = await app.login();
    assert.equal((await app.call('/api/bootstrap', a.cookie)).status, 200);
    assert.equal((await app.call('/api/bootstrap', a.cookie + '; ' + a.cookie)).status, 401);
    assert.equal((await app.call('/api/fixtures/bootstrap', a.cookie)).status, 404);
    const logout = await app.call('/api/session', a.cookie, 'DELETE'); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await app.call('/api/bootstrap', a.cookie)).status, 401);
  } finally { await app.close(); }
});

test('invitation guesses are rate limited independently of a supplied cookie', async () => {
  const app = await start();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await app.call('/api/session', '', 'POST', { accessCode: 'wrong' })).status, 403);
    assert.equal((await app.call('/api/session', '', 'POST', { accessCode: invite })).status, 429);
    await app.login('192.0.2.11');
  } finally { await app.close(); }
});

test('one admitted run across visitors; identical concurrent retries reuse it without extra provider calls', async () => {
  let release!: () => void, entered!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const app = await start({ fetchImpl: async () => { calls++; entered(); await gate; throw Error('Synthetic failure'); } });
  try {
    const a = await app.login(), b = await app.login();
    const responses = await Promise.all([app.call('/api/runs', a.cookie, 'POST', input('same')), app.call('/api/runs', a.cookie, 'POST', input('same'))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 202]);
    const bodies = await Promise.all(responses.map(r => r.json())) as any[]; assert.equal(bodies[0].run.runId, bodies[1].run.runId);
    await started; assert.equal(calls, 1);
    assert.equal((await app.call('/api/runs', b.cookie, 'POST', input('other'))).status, 409);
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', { ...input('same'), instruction: 'Changed payload' })).status, 409);
    assert.equal((await app.call('/api/session/new', a.cookie, 'POST', { contractVersion: c.CONTRACT_VERSION, requestId: 'reset', expectedWorkspaceId: a.status.workspaceId })).status, 409);
    assert.equal((await app.call('/api/runs/' + bodies[0].run.runId, b.cookie)).status, 404);
    release(); const status = await app.idle(a.cookie); assert.equal(status.runsRemaining, 2); assert.equal(status.launchRunsRemaining, 2);
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('same'))).status, 200); assert.equal(calls, 1);
  } finally { release(); await app.close(); }
});

test('fresh design is isolated, explicit and idempotent without resetting the visitor budget', async () => {
  const app = await start();
  try {
    const a = await app.login(); await app.call('/api/runs', a.cookie, 'POST', input('first')); await app.idle(a.cookie);
    const before = await (await app.call('/api/bootstrap', a.cookie)).json() as any;
    const reset = { contractVersion: c.CONTRACT_VERSION, requestId: 'fresh', expectedWorkspaceId: a.status.workspaceId };
    const first = c.SessionStatusSchema.parse(await (await app.call('/api/session/new', a.cookie, 'POST', reset)).json()); assert(first.authenticated);
    assert.notEqual(first.workspaceId, a.status.workspaceId); assert.equal(first.runsRemaining, 2);
    const retry = c.SessionStatusSchema.parse(await (await app.call('/api/session/new', a.cookie, 'POST', reset)).json()); assert(retry.authenticated); assert.equal(first.workspaceId, retry.workspaceId);
    const after = await (await app.call('/api/bootstrap', a.cookie)).json() as any; assert.equal(after.runs.length, 0);
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('first'))).status, 409);
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('new_from_old_tab'))).status, 409);
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('no_binding'), { [c.PUBLIC_WORKSPACE_HEADER]: '' })).status, 409);
    const unchanged = await app.idle(a.cookie); assert.equal(unchanged.runsRemaining, 2);
    assert.equal((await (await app.call('/api/bootstrap', a.cookie)).json() as any).runs.length, 0);
    app.bind(a.cookie, first.workspaceId);
    assert.equal((await app.call('/api/runs/' + before.runs[0].runId, a.cookie)).status, 404);
    assert.equal((await app.call('/api/session/new', a.cookie, 'POST', { ...reset, requestId: 'stale' })).status, 409);
    for (let i = 0; i < 2; i++) { assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('next_' + i))).status, 202); await app.idle(a.cookie); }
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('over_limit'))).status, 429);
    assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('next_1'))).status, 200);
    assert.equal((await app.call('/api/session/new', a.cookie, 'POST', { ...reset, requestId: 'another', expectedWorkspaceId: first.workspaceId })).status, 429);
  } finally { await app.close(); }
});

test('launch budget is shared and login cannot bypass three admitted runs', async () => {
  const app = await start();
  try {
    for (let visitor = 0; visitor < 3; visitor++) {
      const a = await app.login();
      for (let run = 0; run < 1; run++) { assert.equal((await app.call('/api/runs', a.cookie, 'POST', input('run_' + run))).status, 202); await app.idle(a.cookie); }
    }
    const last = await app.login();
    assert.equal(last.status.launchRunsRemaining, 0); assert.equal(last.status.runsRemaining, 3);
    assert.equal((await app.call('/api/runs', last.cookie, 'POST', input('bypass'))).status, 429);
  } finally { await app.close(); }
});

test('timeout does not release admission while the underlying CAD adapter is still cleaning up', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const app = await start({ timeoutMs: 120, fetchImpl: async () => providerResponse(), tool: async () => { entered(); await gate; throw Error('Synthetic late cleanup'); } });
  try {
    const a = await app.login(), b = await app.login();
    await app.call('/api/runs', a.cookie, 'POST', input('timed')); await started; await delay(160);
    const bootstrap = await (await app.call('/api/bootstrap', a.cookie)).json() as any; assert.equal(bootstrap.runs[0].error.code, 'RUN_TIMEOUT');
    assert.equal((await app.call('/api/runs', b.cookie, 'POST', input('while_cleanup'))).status, 409);
    release(); await app.idle(a.cookie);
    assert.equal((await app.call('/api/runs', b.cookie, 'POST', input('after_cleanup'))).status, 202); await app.idle(b.cookie);
  } finally { release(); await app.close(); }
});

test('accepted files and packages keep exact identity within one visitor and deny another visitor', async () => {
  const app = await start({ fetchImpl: async () => providerResponse(), tool: syntheticTool });
  try {
    const a = await app.login(), b = await app.login();
    await app.call('/api/runs', a.cookie, 'POST', input('checked')); await app.idle(a.cookie);
    const bootstrap = await (await app.call('/api/bootstrap', a.cookie)).json() as any;
    const candidate = c.CandidateSchema.parse(bootstrap.candidates[0]), design = bootstrap.design;
    await c.verifyCandidateEvidence(candidate); assert.equal(candidate.status, 'reviewable');
    const request = { contractVersion: c.CONTRACT_VERSION, requestId: 'accept', designId: design.designId, candidateRevisionId: candidate.revisionId,
      requirementsVersion: candidate.requirementsVersion, expectedStateVersion: design.stateVersion, expectedAcceptedRevisionId: null,
      registryHash: candidate.registryHash, setupHash: candidate.setupHash, geometryHash: candidate.geometryHash!, checkBundleHash: candidate.checkBundleHash!, userActionId: 'explicit_test_action' };
    assert.equal((await app.call(`/api/revisions/${candidate.revisionId}/accept`, b.cookie, 'POST', request)).status, 409);
    const acceptance = await (await app.call(`/api/revisions/${candidate.revisionId}/accept`, a.cookie, 'POST', request)).json() as any;
    await verifyAcceptanceResponse(acceptance, request);
    for (const artifact of candidate.artifacts) {
      assert.equal((await app.call(artifact.href, b.cookie)).status, 404);
      const response = await app.call(artifact.href, a.cookie); assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-WorldKinetics-Revision'), candidate.revisionId); assert.equal(response.headers.get('X-WorldKinetics-Applicability'), 'current');
      assert.equal(await c.sha256(new Uint8Array(await response.arrayBuffer())), artifact.sha256);
    }
    const packageRequest = { contractVersion: c.CONTRACT_VERSION, requestId: 'package', acceptanceId: acceptance.acceptance.acceptanceId,
      manifestId: acceptance.manifest.manifestId, manifestHash: acceptance.manifest.manifestHash };
    const route = `/api/revisions/${candidate.revisionId}/package`;
    assert.equal((await app.call(route, b.cookie, 'POST', packageRequest)).status, 409);
    const response = await app.call(route, a.cookie, 'POST', packageRequest); assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(response.headers.get('Content-Length'), String(bytes.length));
    assert.equal(await c.sha256(bytes), response.headers.get(c.PACKAGE_HEADERS.sha256));
    assert.equal(response.headers.get(c.PACKAGE_HEADERS.manifestHash), acceptance.manifest.manifestHash);
    assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.match(response.headers.get('Content-Disposition')!, /prototype.zip/);
    assert.deepEqual(await (await app.call('/api/acceptances', b.cookie)).json(), { contractVersion: c.CONTRACT_VERSION, acceptances: [], manifests: [] });
  } finally { await app.close(); }
});

test('combined edge, frontend session client and backend preserve a custom request through checked acceptance and ZIP', async t => {
  const edgeModule = '../../deployment/cloudflare/worker.mjs';
  const { default: worker } = await import(edgeModule);
  const directFetch = globalThis.fetch;
  let instruction = '', providerCalls = 0;
  const app = await start({ fetchImpl: async (_url, init) => {
    providerCalls++; instruction = JSON.parse(JSON.parse(String(init?.body)).input).instruction;
    return providerResponse();
  }, tool: syntheticTool });
  const env = { API_ORIGIN: 'https://dedicated.synthetic.example', UPSTREAM_KEY: upstream, ASSETS: { fetch: async () => new Response('Synthetic static asset') } };
  t.mock.method(globalThis, 'fetch', async (target: URL, init: RequestInit) => {
    const url = new URL(String(target)); assert.equal(url.origin, env.API_ORIGIN);
    const local = new URL(app.base); local.pathname = url.pathname; local.search = url.search;
    return directFetch(local, { ...init, duplex: 'half' } as RequestInit);
  });
  let jar = '';
  const browserFetch: typeof fetch = async (route, init) => {
    const headers = new Headers(init?.headers); headers.set('Cookie', jar); headers.set('CF-Connecting-IP', '192.0.2.15');
    if (init?.method && init.method !== 'GET') headers.set('Origin', origin);
    const response = await worker.fetch(new Request(new URL(String(route), origin), { ...init, headers }), env) as Response;
    if (response.headers.has('set-cookie')) jar = response.headers.get('set-cookie')!.split(';')[0]!;
    return response;
  };
  const transport = createWorkspaceTransport(browserFetch);
  const browserPost = (route: string, body: unknown) => transport.fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const client = createSessionClient(browserFetch, 'worldkinetics.app');
    assert.equal((await client.status())?.authenticated, false);
    const session = await client.login(invite); assert(session?.authenticated);
    transport.bind(session.workspaceId);
    const request = { ...input('edge_custom'), instruction: 'Create a smooth arch with a narrow grip for this cabinet.' };
    assert.equal((await browserPost('/api/runs', request)).status, 202);
    for (let i = 0; i < 200; i++) { const status = await client.status(); if (status?.authenticated && !status.busy) break; await delay(10); }
    const state = await (await browserFetch('/api/bootstrap')).json() as any;
    const candidate = c.CandidateSchema.parse(state.candidates[0]); assert.equal(candidate.status, 'reviewable');
    assert.equal(instruction, request.instruction); assert.equal(providerCalls, 1); await c.verifyCandidateEvidence(candidate);
    const accept = { contractVersion: c.CONTRACT_VERSION, requestId: 'edge_accept', designId: 'handle', candidateRevisionId: candidate.revisionId,
      requirementsVersion: 1, expectedStateVersion: state.design.stateVersion, expectedAcceptedRevisionId: null, registryHash: candidate.registryHash,
      setupHash: candidate.setupHash, geometryHash: candidate.geometryHash!, checkBundleHash: candidate.checkBundleHash!, userActionId: 'explicit_edge_accept' };
    const accepted = await (await browserPost(`/api/revisions/${candidate.revisionId}/accept`, accept)).json() as any;
    await verifyAcceptanceResponse(accepted, accept);
    const packageResponse = await browserPost(`/api/revisions/${candidate.revisionId}/package`, { contractVersion: c.CONTRACT_VERSION,
      requestId: 'edge_package', acceptanceId: accepted.acceptance.acceptanceId, manifestId: accepted.manifest.manifestId, manifestHash: accepted.manifest.manifestHash });
    assert.equal(packageResponse.status, 200); const bytes = new Uint8Array(await packageResponse.arrayBuffer());
    assert.equal(await c.sha256(bytes), packageResponse.headers.get(c.PACKAGE_HEADERS.sha256));
    assert.equal(packageResponse.headers.get(c.PACKAGE_HEADERS.revisionId), candidate.revisionId);
    assert.equal(packageResponse.headers.get('Content-Type'), 'application/zip'); assert.equal(packageResponse.headers.get('Cache-Control'), 'no-store');
    const fresh = await client.newDesign(session.workspaceId); assert(fresh.authenticated); assert.equal(fresh.runsRemaining, 2);
    assert.equal((await browserPost('/api/runs', request)).status, 409);
    assert.equal((await (await browserFetch('/api/bootstrap')).json() as any).runs.length, 0);
    assert.equal((await client.logout())?.authenticated, false);
    assert.equal((await browserFetch('/api/bootstrap')).status, 401); assert.equal(providerCalls, 1);
  } finally { await app.close(); }
});

// A deliberately short operator-selected code still uses the same admission checks.
test('operator-selected short invitation authenticates without changing run budgets', async () => {
  const app = await start({ inviteCode: 'test' });
  try {
    assert.equal((await app.call('/api/session', '', 'POST', { accessCode: 'wrong' })).status, 403);
    const response = await app.call('/api/session', '', 'POST', { accessCode: 'test' });
    assert.equal(response.status, 200);
    const session = c.SessionStatusSchema.parse(await response.json());
    assert(session.authenticated);
    assert.equal(session.runsPerSession, 3);
    assert.equal(session.runsPerLaunch, 3);
  } finally { await app.close(); }
});

test('operator access has a separate bounded budget and cannot be selected by a visitor payload', async () => {
  const operatorCode = 'synthetic-operator-credential-for-tests-only';
  const app = await start({ operatorCode, operatorRunLimit: 5 });
  try {
    const visitor = await app.login();
    assert.equal((await app.call('/api/session', '', 'POST', { accessCode: invite, accessRole: 'operator' })).status, 400);
    assert.equal((await app.call('/api/session', visitor.cookie, 'POST', { accessCode: operatorCode })).status, 409);
    for (let i = 0; i < 3; i++) {
      assert.equal((await app.call('/api/runs', visitor.cookie, 'POST', input('visitor_' + i))).status, 202);
      await app.idle(visitor.cookie);
    }
    const response = await app.call('/api/session', '', 'POST', { accessCode: operatorCode });
    assert.equal(response.status, 200);
    const status = c.SessionStatusSchema.parse(await response.json()); assert(status.authenticated);
    assert.equal(status.accessRole, 'operator'); assert.equal(status.runsRemaining, 5); assert.equal(status.launchRunsRemaining, 5);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!; app.bind(cookie, status.workspaceId);
    for (let i = 0; i < 5; i++) {
      assert.equal((await app.call('/api/runs', cookie, 'POST', input('operator_' + i))).status, 202);
      await app.idle(cookie);
    }
    assert.equal((await app.call('/api/runs', cookie, 'POST', input('operator_over'))).status, 429);
    assert.equal((await app.call('/api/runs', cookie, 'POST', input('operator_4'))).status, 200);
    assert.equal((await app.call('/api/runs', visitor.cookie, 'POST', input('visitor_over'))).status, 429);
    const visitorStatus = await app.idle(visitor.cookie); assert.equal(visitorStatus.launchRunsRemaining, 0);
    await app.call('/api/session', cookie, 'DELETE');
    const relogin = await app.call('/api/session', '', 'POST', { accessCode: operatorCode }, { 'X-WorldKinetics-Client-IP': '192.0.2.12' });
    const later = c.SessionStatusSchema.parse(await relogin.json()); assert(later.authenticated);
    assert.equal(later.launchRunsRemaining, 0); assert.equal(later.canStartNewDesign, false);
    const newCookie = relogin.headers.get('set-cookie')!.split(';')[0]!; app.bind(newCookie, later.workspaceId);
    assert.equal((await app.call('/api/runs', newCookie, 'POST', input('new_cookie_bypass'))).status, 429);
  } finally { await app.close(); }
});

test('operator credential is optional, distinct and strong; default operator allowance is thirty', async () => {
  const config = await options();
  for (const override of [{ operatorCode: 'short' }, { operatorCode: upstream }, { operatorCode: '' }, { operatorRunLimit: 0 }, { operatorRunLimit: 1001 }]) {
    await assert.rejects(createPublicDemo({ ...config, ...override }));
  }
  const code = 'synthetic-operator-credential-for-tests-only';
  const disabled = await start();
  try { assert.equal((await disabled.call('/api/session', '', 'POST', { accessCode: code })).status, 403); }
  finally { await disabled.close(); }
  const app = await start({ operatorCode: code });
  try {
    const r = await app.call('/api/session', '', 'POST', { accessCode: code });
    const status = c.SessionStatusSchema.parse(await r.json()); assert(status.authenticated);
    assert.equal(status.runsPerSession, 30); assert.equal(status.runsPerLaunch, 30);
    assert.equal((await (await app.call('/api/session')).json() as any).runsPerLaunch, 3);
  } finally { await app.close(); }
});

test('an operator upgrade preserves the already-consumed public allowance', async () => {
  const app = await start({ initialPublicRuns: 1 });
  try {
    const visitor = await app.login(); assert.equal(visitor.status.launchRunsRemaining, 2);
    for (let i = 0; i < 2; i++) { await app.call('/api/runs', visitor.cookie, 'POST', input('remaining_' + i)); await app.idle(visitor.cookie); }
    assert.equal((await app.call('/api/runs', visitor.cookie, 'POST', input('must_not_refill'))).status, 429);
  } finally { await app.close(); }
  const config = await options();
  for (const initialPublicRuns of [-1, 4, 0.5]) await assert.rejects(createPublicDemo({ ...config, initialPublicRuns }));
});

test('explicit unlimited operator access does not remove the public ceiling', async () => {
  const code = 'synthetic-unlimited-operator-credential-only';
  const app = await start({ operatorCode: code, operatorRunLimit: null, initialPublicRuns: 3 });
  try {
    const response = await app.call('/api/session', '', 'POST', { accessCode: code });
    const status = c.SessionStatusSchema.parse(await response.json()); assert(status.authenticated);
    assert.equal(status.accessRole, 'operator');
    assert.equal(status.runsPerSession, null); assert.equal(status.runsPerLaunch, null);
    assert.equal(status.runsRemaining, null); assert.equal(status.launchRunsRemaining, null);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!; app.bind(cookie, status.workspaceId);
    for (let i = 0; i < 4; i++) {
      assert.equal((await app.call('/api/runs', cookie, 'POST', input('unlimited_' + i))).status, 202);
      await app.idle(cookie);
    }
    const after = await app.idle(cookie); assert.equal(after.launchRunsRemaining, null);
    const visitor = await app.login(); assert.equal(visitor.status.launchRunsRemaining, 0);
    assert.equal((await app.call('/api/runs', visitor.cookie, 'POST', input('public_still_blocked'))).status, 429);
    assert.equal(c.SessionStatusSchema.safeParse({ ...status, accessRole: 'visitor' }).success, false);
    assert.equal(c.SessionStatusSchema.safeParse({ ...status, runsRemaining: 1000 }).success, false);
    assert.equal(c.SessionStatusSchema.safeParse({ ...status, accessRole: undefined }).success, false);
  } finally { await app.close(); }
});
