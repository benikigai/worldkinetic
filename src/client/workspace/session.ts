import { CONTRACT_VERSION } from '../../shared/contracts-v2.js';
import { NewSessionDesignSchema, SessionLoginSchema, SessionStatusSchema, type NewSessionDesign, type SessionStatus } from '../../shared/session-v2.js';

const localHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export function createSessionClient(fetcher: typeof fetch, hostname: string) {
  let pendingNew: NewSessionDesign | null = null;
  async function call(method: string, path: string, body?: unknown): Promise<SessionStatus | null> {
    const response = await fetcher(path, { method, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20_000), headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined });
    if (response.status === 404 && method === 'GET' && path === '/api/session' && localHost(hostname)) { await response.body?.cancel(); return null; }
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      throw new Error(response.status === 403 ? 'That access code was not accepted.'
        : response.status === 401 ? 'Your session ended. Enter your access code again.'
          : response.status === 429 ? 'The demo limit has been reached. Try again later.'
            : response.status === 409 ? 'A design is busy or the session changed. Check access before retrying.'
              : 'The demo service is unavailable. Try Check access.');
    }
    if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' || !response.body) {
      await response.body?.cancel(); throw new Error('Access could not be verified. Try Check access.');
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length;
      if (length > 16384) { await reader.cancel(); throw new Error('Access response could not be verified.'); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const status = SessionStatusSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (status.authenticated && Date.parse(status.expiresAt) <= Date.now()) throw new Error('Your session ended. Enter your access code again.');
    return status;
  }
  return {
    status: () => call('GET', '/api/session'),
    login: (accessCode: string) => call('POST', '/api/session', SessionLoginSchema.parse({ accessCode })),
    logout: () => call('DELETE', '/api/session'),
    async newDesign(workspaceId: string) {
      if (!pendingNew) pendingNew = NewSessionDesignSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: `browser_${crypto.randomUUID()}`, expectedWorkspaceId: workspaceId });
      if (pendingNew.expectedWorkspaceId !== workspaceId) throw new Error('Check access before starting another design.');
      const result = await call('POST', '/api/session/new', pendingNew);
      if (!result?.authenticated || result.workspaceId === workspaceId) throw new Error('A new design was not confirmed. Check access before retrying.');
      pendingNew = null;
      return result;
    },
  };
}

export function createWorkspaceTransport(fetcher: typeof fetch) {
  let binding: string | null | undefined;
  return {
    bind(workspaceId: string | null) {
      if (binding !== undefined && binding !== workspaceId) throw new Error('Reload before entering a different workspace.');
      binding = workspaceId;
    },
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      if (binding === undefined) throw new Error('Workspace access has not been verified.');
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      // Agreed backend child-mutation header; the binding is fixed for this controller lifetime.
      headers.delete('X-WorldKinetics-Workspace');
      if (binding !== null && method !== 'GET' && method !== 'HEAD') headers.set('X-WorldKinetics-Workspace', binding);
      return fetcher(input, { ...init, headers });
    }) as typeof fetch,
  };
}

export function mountSession(signal: AbortSignal, access: (allowed: boolean, workspaceId: string | null) => void) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const client = createSessionClient(window.fetch.bind(window), window.location.hostname);
  let status: SessionStatus | null = null, local = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined;
  let workspaceId: string | null = null;
  const message = (value: string) => { get('session-message').textContent = value; get('session-action-status').textContent = value; };
  function render() {
    const allowed = local || Boolean(status?.authenticated);
    get('session-gate').hidden = allowed;
    get('session-bar').hidden = !status?.authenticated;
    get('workspace-content').hidden = !allowed;
    for (const id of ['session-login', 'session-check', 'session-logout']) get<HTMLButtonElement>(id).disabled = busy;
    get<HTMLButtonElement>('session-new').disabled = busy || !status?.authenticated || !status.canStartNewDesign || status.busy;
    if (status?.authenticated) get('session-budget').textContent = status.accessRole === 'operator' && status.runsPerSession === null
      ? `Admin · Unlimited runs${status.busy ? ' · Demo busy' : ''}`
      : `${status.accessRole === 'operator' ? 'Admin allowance' : 'Public allowance'} · ${status.runsRemaining} session runs left · ${status.launchRunsRemaining} total runs available${status.busy ? ' · Demo busy' : ''}`;
    access(allowed, status?.authenticated ? status.workspaceId : null);
  }
  async function run(action: () => Promise<SessionStatus | null>, reset = false) {
    if (busy) return;
    busy = true; render();
    try {
      const next = await action();
      if (signal.aborted) return;
      local = next === null; status = next;
      if (next?.authenticated) {
        if (reset || (workspaceId && workspaceId !== next.workspaceId)) { window.location.reload(); return; }
        workspaceId = next.workspaceId;
      } else workspaceId = null;
      message(next?.authenticated ? '' : local ? '' : 'Enter your invitation code to start.');
    } catch (error) {
      local = false; status = null;
      message(error instanceof Error && !(error.name === 'ZodError') ? error.message : 'Access could not be verified. Try Check access.');
    } finally { busy = false; if (!signal.aborted) render(); }
  }
  get('session-form').addEventListener('submit', event => {
    event.preventDefault(); const input = get<HTMLInputElement>('session-code'), code = input.value; input.value = '';
    void run(() => client.login(code), true);
  }, { signal });
  get('session-check').addEventListener('click', () => { void run(client.status); }, { signal });
  get('session-logout').addEventListener('click', () => { void run(async () => { const next = await client.logout(); if (next && !next.authenticated) window.location.reload(); return next; }); }, { signal });
  get('session-new').addEventListener('click', () => {
    if (status?.authenticated && status.canStartNewDesign && !status.busy) { const id = status.workspaceId; void run(() => client.newDesign(id), true); }
  }, { signal });
  async function poll() { await run(client.status); if (!signal.aborted) timer = setTimeout(poll, 10_000); }
  signal.addEventListener('abort', () => { if (timer) clearTimeout(timer); }, { once: true });
  void poll();
}
