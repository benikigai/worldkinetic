import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { CONTRACT_VERSION, ErrorCodeSchema, NewSessionDesignSchema, PUBLIC_DEMO_LIMITS as limits,
  PUBLIC_SESSION_COOKIE, SessionLoginSchema, SessionStatusSchema, parseStrictJson, safeError,
  type SessionStatus, type ToolAdapter } from '../shared/contracts.js';
import { cadToolAdapter } from '../tools/adapter.js';
import { createHandleApplication } from './handle-app.js';
import { StoreError } from './store.js';

type HandleApp = Awaited<ReturnType<typeof createHandleApplication>>;
type HandleOptions = Parameters<typeof createHandleApplication>[0];
interface Visitor {
  token: string;
  expiresAt: number;
  runs: number;
  designs: number;
  workspaceId: string;
  app: HandleApp;
  resets: Map<string, { from: string; to: string }>;
}
export interface PublicDemoOptions {
  runtimeDir: string;
  publicOrigin: string;
  upstreamKey: string;
  inviteCode: string;
  referenceFiles: HandleOptions['referenceFiles'];
  apiKey?: string;
  fetchImpl?: typeof fetch;
  tool?: ToolAdapter;
  timeoutMs?: number;
}
const digest = (value: string) => createHash('sha256').update(value).digest();
const sameSecret = (value: string, expected: Buffer) => timingSafeEqual(digest(value), expected);
function fail(status: number, code: Parameters<typeof safeError>[0]): never {
  throw new StoreError(status, code, safeError(code).message);
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
function cookie(request: IncomingMessage) {
  const matches = (request.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(PUBLIC_SESSION_COOKIE + '='));
  if (matches.length !== 1) return undefined;
  const token = matches[0]!.slice(PUBLIC_SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
function setCookie(response: ServerResponse, token: string, maxAge = limits.sessionHours * 3600) {
  response.setHeader('Set-Cookie', `${PUBLIC_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
}
async function body(request: IncomingMessage) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) fail(415, 'INVALID_REQUEST');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) fail(413, 'INVALID_REQUEST');
    chunks.push(chunk);
  }
  try { return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { return fail(400, 'INVALID_REQUEST'); }
}

/** A bounded invited demo on one host. Session cookies and budgets last for this launch only. */
export async function createPublicDemo(options: PublicDemoOptions) {
  let origin: URL;
  try { origin = new URL(options.publicOrigin); } catch { throw new Error('An exact HTTPS public origin is required.'); }
  if (origin.protocol !== 'https:' || origin.origin !== options.publicOrigin
    || options.upstreamKey?.length < 32 || !options.upstreamKey || options.inviteCode?.length < 16 || !options.inviteCode
    || options.inviteCode.length > 128 || options.upstreamKey === options.inviteCode) {
    throw new Error('Public demo requires an exact HTTPS origin and distinct upstream and invitation secrets.');
  }
  const upstreamHash = digest(options.upstreamKey), inviteHash = digest(options.inviteCode);
  await mkdir(options.runtimeDir, { recursive: true, mode: 0o700 });
  if ((await lstat(options.runtimeDir)).isSymbolicLink()) throw new Error('Runtime directory cannot be a symlink.');
  const runtimeDir = await realpath(options.runtimeDir);
  const lockPath = path.join(runtimeDir, 'public.instance.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lock, String(process.pid));
  let released = false;
  const release = () => {
    if (released) return;
    released = true; closeSync(lock); unlinkSync(lockPath); process.removeListener('exit', release);
  };
  process.once('exit', release);
  const visitors = new Map<string, Visitor>(), apps = new Set<HandleApp>();
  const jobs = new Map<Promise<unknown>, Visitor>(), tools = new Map<Promise<unknown>, Visitor>();
  let runs = 0, poisoned = false, closing = false;
  const packageGate = { busy: false };
  let boundary = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = boundary.then(operation);
    boundary = result.then(() => undefined, () => undefined);
    return result;
  }
  const busy = () => poisoned || jobs.size > 0 || tools.size > 0;
  const visitorBusy = (visitor: Visitor) => [...jobs.values(), ...tools.values()].includes(visitor);
  const loginWindows = new Map<string, { start: number; count: number }>();
  let globalLogin = { start: 0, count: 0 };
  function checkLoginRate(request: IncomingMessage) {
    const now = Date.now();
    const trustedIp = request.headers['x-worldkinetics-client-ip'];
    const key = typeof trustedIp === 'string' && isIP(trustedIp) ? trustedIp : 'unknown';
    for (const [ip, window] of loginWindows) if (now - window.start >= 60_000) loginWindows.delete(ip);
    if (now - globalLogin.start >= 60_000) globalLogin = { start: now, count: 0 };
    if (++globalLogin.count > 20) fail(429, 'DEMO_LIMIT');
    const window = loginWindows.get(key) ?? { start: now, count: 0 };
    loginWindows.set(key, window);
    if (++window.count > 5) fail(429, 'DEMO_LIMIT');
  }
  const status = (visitor?: Visitor): SessionStatus => SessionStatusSchema.parse({
    contractVersion: CONTRACT_VERSION, accessMode: 'invite', runsPerSession: limits.runsPerSession, runsPerLaunch: limits.runsPerLaunch,
    ...(visitor ? { authenticated: true, workspaceId: visitor.workspaceId, runsRemaining: limits.runsPerSession - visitor.runs,
      launchRunsRemaining: limits.runsPerLaunch - runs, busy: busy(), expiresAt: new Date(visitor.expiresAt).toISOString(),
      canStartNewDesign: !visitorBusy(visitor) && visitor.runs < limits.runsPerSession && runs < limits.runsPerLaunch && visitor.designs < limits.designsPerSession,
    } : { authenticated: false }),
  });
  async function newApp(visitor: Visitor, workspaceId: string): Promise<HandleApp> {
    const tool: ToolAdapter = input => {
      const job = Promise.resolve().then(() => (options.tool ?? cadToolAdapter)(input));
      tools.set(job, visitor);
      // A timeout can end the executor before container cleanup settles. Keep admission closed until both finish.
      void job.finally(() => tools.delete(job)).catch(() => undefined);
      return job;
    };
    const app = await createHandleApplication({ runtimeDir: path.join(runtimeDir, workspaceId), referenceFiles: options.referenceFiles,
      apiKey: options.apiKey, fetchImpl: options.fetchImpl, tool, timeoutMs: options.timeoutMs, manageProcessExit: false,
      appOptions: { publicOrigin: options.publicOrigin, includeFixtures: false, packageGate,
        dispatchRun: (store, input, execute) => serialize(async () => {
          if (closing || visitor.expiresAt <= Date.now() || visitor.app?.store !== store) fail(409, 'STATE_CONFLICT');
          const retry = store.getRunRetry(input);
          if (retry) return retry;
          if (busy()) fail(409, 'DEMO_BUSY');
          if (visitor.runs >= limits.runsPerSession || runs >= limits.runsPerLaunch) fail(429, 'DEMO_LIMIT');
          const result = await store.enqueueRun(input);
          if (!result.reused) {
            visitor.runs++; runs++;
            const job = Promise.resolve().then(() => execute(result.run.runId));
            jobs.set(job, visitor);
            void job.catch(() => { poisoned = true; }).finally(() => jobs.delete(job));
          }
          return result;
        }),
      } });
    apps.add(app);
    return app;
  }
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    try {
      const upstream = request.headers['x-worldkinetics-upstream-key'];
      if (typeof upstream !== 'string' || !sameSecret(upstream, upstreamHash)) fail(403, 'ACCESS_DENIED');
      if (closing) fail(503, 'TOOL_UNAVAILABLE');
      const originHeader = request.headers.origin;
      if ((originHeader && originHeader !== options.publicOrigin)
        || (request.method !== 'GET' && originHeader !== options.publicOrigin)) fail(403, 'ACCESS_DENIED');
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) fail(404, 'INVALID_REQUEST');
      const token = cookie(request), known = token ? visitors.get(token) : undefined;
      const visitor = known && known.expiresAt > Date.now() ? known : undefined;
      if (url.pathname === '/api/session') {
        if (request.method === 'GET') return json(response, 200, status(visitor));
        if (request.method === 'POST') {
          checkLoginRate(request);
          const parsed = SessionLoginSchema.safeParse(await body(request));
          if (!parsed.success) fail(400, 'INVALID_REQUEST');
          if (!sameSecret(parsed.data.accessCode, inviteHash)) fail(403, 'ACCESS_DENIED');
          return await serialize(async () => {
            if (visitor) return json(response, 200, status(visitor));
            if (visitors.size >= limits.sessionsPerLaunch) fail(429, 'DEMO_LIMIT');
            const token = randomBytes(32).toString('hex'), workspaceId = 'workspace_' + randomUUID();
            const created = { token, workspaceId, expiresAt: Date.now() + limits.sessionHours * 3600_000,
              runs: 0, designs: 1, resets: new Map() } as Visitor;
            created.app = await newApp(created, workspaceId);
            visitors.set(token, created);
            setCookie(response, token);
            return json(response, 200, status(created));
          });
        }
        if (request.method === 'DELETE') {
          if (visitor) visitor.expiresAt = 0;
          setCookie(response, '', 0);
          return json(response, 200, status());
        }
        fail(405, 'INVALID_REQUEST');
      }
      if (!visitor) fail(401, 'ACCESS_REQUIRED');
      if (url.pathname === '/api/session/new') {
        if (request.method !== 'POST') fail(405, 'INVALID_REQUEST');
        const parsed = NewSessionDesignSchema.safeParse(await body(request));
        if (!parsed.success) fail(400, 'INVALID_REQUEST');
        return await serialize(async () => {
          const prior = visitor.resets.get(parsed.data.requestId);
          if (prior) {
            if (prior.from !== parsed.data.expectedWorkspaceId || prior.to !== visitor.workspaceId) fail(409, 'IDENTITY_CONFLICT');
            return json(response, 200, status(visitor));
          }
          if (visitor.workspaceId !== parsed.data.expectedWorkspaceId || visitor.expiresAt <= Date.now()) fail(409, 'STATE_CONFLICT');
          if (visitorBusy(visitor)) fail(409, 'DEMO_BUSY');
          if (visitor.runs >= limits.runsPerSession || runs >= limits.runsPerLaunch || visitor.designs >= limits.designsPerSession) fail(429, 'DEMO_LIMIT');
          const workspaceId = 'workspace_' + randomUUID();
          const app = await newApp(visitor, workspaceId);
          visitor.resets.set(parsed.data.requestId, { from: visitor.workspaceId, to: workspaceId });
          visitor.workspaceId = workspaceId; visitor.app = app; visitor.designs++;
          return json(response, 200, status(visitor));
        });
      }
      // Child applications never listen on a port and can see only their own store and artifacts.
      visitor.app.server.emit('request', request, response);
    } catch (error) {
      const code = error instanceof StoreError ? ErrorCodeSchema.safeParse(error.code) : null;
      json(response, error instanceof StoreError ? error.status : 503, {
        contractVersion: CONTRACT_VERSION, error: safeError(code?.success ? code.data : 'TOOL_UNAVAILABLE'),
      });
    }
  });
  server.maxConnections = 64;
  async function close() {
    closing = true;
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await boundary;
    await Promise.allSettled([...jobs.keys()]);
    await Promise.allSettled([...tools.keys()]);
    for (const app of apps) app.server.emit('close');
    release();
  }
  return { server, close };
}
