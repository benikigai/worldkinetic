import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BootstrapSchema, CONTRACT_VERSION, IdSchema, RunRequestSchema, RunSchema } from '../shared/contracts.js';
import { RunStore, StoreError } from './store.js';
import { ArtifactStore } from './artifacts.js';
import { Executor, type SelectedOperation } from './execution.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRun = RunSchema.parse(JSON.parse(await readFile(path.join(root, 'fixtures/api/run.fixture.json'), 'utf8')));

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function readRequest(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new StoreError(415, 'CONTENT_TYPE', 'Use application/json.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new StoreError(413, 'REQUEST_TOO_LARGE', 'Request body exceeds 16 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new StoreError(400, 'INVALID_JSON', 'Request body is not valid JSON.'); }
}

export function createApp(store: RunStore, runtimeDir: string, selected: SelectedOperation | null = null, timeoutMs?: number) {
  const artifacts = new ArtifactStore(path.join(runtimeDir, 'artifacts'));
  const executor = new Executor(store, artifacts, runtimeDir, selected, timeoutMs);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const pathname = url.pathname;
      // The demo is loopback-only. Reject browser requests from unrelated origins.
      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) throw new StoreError(403, 'ORIGIN_REJECTED', 'Use the application origin.');
      if (request.method === 'GET' && pathname === '/api/health') {
        return json(response, 200, { status: 'ok', contractVersion: CONTRACT_VERSION, scopeStatus: selected ? 'selected' : 'not_selected', providerConfigured: Boolean(selected), executionMode: selected ? 'live' : 'unavailable' });
      }
      if (request.method === 'GET' && pathname === '/api/bootstrap') {
        return json(response, 200, BootstrapSchema.parse({
          contractVersion: CONTRACT_VERSION, scopeStatus: selected ? 'selected' : 'not_selected', executionMode: selected ? 'live' : 'unavailable',
          design: store.getDesign(), runs: store.listRuns(), unavailableReason: selected ? null : 'PLAN has not selected the object and operation; the live tool adapter is not connected.',
        }));
      }
      if (request.method === 'GET' && pathname === '/api/fixtures/run') return json(response, 200, fixtureRun);
      if (request.method === 'GET' && pathname === '/api/fixtures/events') return json(response, 200, JSON.parse(await readFile(path.join(root, 'fixtures/api/events.fixture.json'), 'utf8')));
      if (request.method === 'POST' && pathname === '/api/runs') {
        const parsed = RunRequestSchema.safeParse(await readRequest(request));
        if (!parsed.success) throw new StoreError(400, 'INVALID_REQUEST', 'Request does not match the shared contract. Check version, IDs, units and instruction.');
        if (!selected) throw new StoreError(503, 'SCOPE_NOT_SELECTED', 'A selected operation and live tool adapter are required.');
        const { run, reused } = store.accept(parsed.data);
        if (!reused) queueMicrotask(() => { void executor.execute(run.runId); });
        return json(response, reused ? 200 : 202, { contractVersion: CONTRACT_VERSION, reused, run });
      }
      const runRoute = /^\/api\/runs\/([^/]+)(\/events)?$/.exec(pathname);
      if (request.method === 'GET' && runRoute) {
        const id = IdSchema.safeParse(runRoute[1]);
        if (!id.success || !store.getRun(id.data)) throw new StoreError(404, 'RUN_NOT_FOUND', 'Run not found.');
        if (runRoute[2]) {
          const raw = url.searchParams.get('after') ?? '0';
          if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new StoreError(400, 'INVALID_CURSOR', 'Use a nonnegative integer event cursor.');
          return json(response, 200, { contractVersion: CONTRACT_VERSION, events: store.getEvents(id.data, Number(raw)) });
        }
        return json(response, 200, store.getRun(id.data));
      }
      const artifactRoute = /^\/api\/artifacts\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && artifactRoute) {
        const id = IdSchema.safeParse(artifactRoute[1]);
        const artifact = id.success ? [...store.listRuns().flatMap(run => run.artifacts), ...fixtureRun.artifacts].find(item => item.artifactId === id.data) : undefined;
        if (!artifact) throw new StoreError(404, 'ARTIFACT_NOT_FOUND', 'Artifact not found.');
        const bytes = artifact.executionMode === 'fixture' ? await readFile(path.join(root, 'fixtures/api/fixture-design.json')) : await artifacts.read(artifact);
        response.writeHead(200, {
          'Content-Type': artifact.mediaType, 'Content-Length': bytes.length,
          'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
          'X-WorldKinetics-Revision': artifact.revisionId, 'X-WorldKinetics-Execution': artifact.executionMode,
        });
        return response.end(bytes);
      }
      if (request.method === 'GET' && (['/', '/theme.css', '/theme.js', '/mark.svg'].includes(pathname) || pathname.startsWith('/assets/'))) {
        const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
        const file = path.resolve(root, 'dist/client', relative);
        if (!file.startsWith(path.resolve(root, 'dist/client') + path.sep)) throw new StoreError(404, 'NOT_FOUND', 'Not found.');
        try {
          const content = await readFile(file);
          const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
          response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
          return response.end(content);
        } catch { throw new StoreError(503, 'FRONTEND_UNAVAILABLE', 'The frontend build is not integrated yet. API: /api/bootstrap.'); }
      }
      throw new StoreError(404, 'NOT_FOUND', 'Route not found.');
    } catch (error) {
      const known = error instanceof StoreError;
      json(response, known ? error.status : 500, {
        contractVersion: CONTRACT_VERSION,
        error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'The request failed. No internal provider details are exposed.', retryable: false },
      });
    }
  });
}
