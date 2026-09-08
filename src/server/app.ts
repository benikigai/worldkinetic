import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcceptanceRequestSchema, RequirementsUpdateRequestSchema, ExportRequestSchema, BootstrapSchema, CONTRACT_VERSION, IdSchema, RunRequestSchema, parseStrictJson, safeError, ErrorCodeSchema, type RunRequest } from '../shared/contracts.js';
import { AcceptanceHistorySchema } from '../shared/state-v2.js';
import { RunStore, StoreError } from './store.js';
import { ArtifactStore } from './artifacts.js';
import { Executor, type SelectedOperation } from './execution.js';
import { readPublicFile } from './static-files.js';
import { ReferenceResponseSchema } from '../shared/reference-v2.js';
import type { PublicReference } from './reference.js';
import { PackageRequestSchema, PACKAGE_HEADERS } from '../shared/package-v2.js';
import { buildPrototypePackage } from './prototype-package.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = BootstrapSchema.parse(JSON.parse(await readFile(path.join(root, 'fixtures/api/v2/reviewable.fixture.json'), 'utf8')));
const fixtureRun = fixture.runs[0]!;
const fixtureRejected = BootstrapSchema.parse(JSON.parse(await readFile(path.join(root, 'fixtures/api/v2/rejected.fixture.json'), 'utf8')));
const fixtureBytes = JSON.parse(await readFile(path.join(root, 'fixtures/api/v2/synthetic-artifact-bytes.fixture.json'), 'utf8')).artifacts as Record<string, string>;

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function readRequest(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.match(/^application\/json(?:\s*;|$)/i)) throw new StoreError(415, 'CONTENT_TYPE', 'Use application/json.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new StoreError(413, 'REQUEST_TOO_LARGE', 'Request body exceeds 8 KiB.');
    chunks.push(chunk);
  }
  try { return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new StoreError(400, 'INVALID_JSON', 'Request body is not valid JSON.'); }
}

export interface AppOptions {
  clientDir?: string;
  reference?: PublicReference;
  publicOrigin?: string;
  includeFixtures?: boolean;
  packageGate?: { busy: boolean };
  dispatchRun?: (store: RunStore, input: RunRequest, execute: (runId: string) => Promise<void>) => ReturnType<RunStore['enqueueRun']>;
}
export function createApp(store: RunStore, runtimeDir: string, selected: SelectedOperation | null = null, timeoutMs?: number, options: AppOptions = {}) {
  const artifacts = new ArtifactStore(path.join(runtimeDir, 'artifacts'));
  const executor = new Executor(store, artifacts, runtimeDir, selected, timeoutMs);
  const packageGate = options.packageGate ?? { busy: false };
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const pathname = url.pathname;
      const available = Boolean(selected && (!selected.baselineOnly || (store.getDesign()?.acceptedRevisionId === null
        && store.getRequirements()?.setupId === 'resize_centered_v1')));
      // Public hosts must supply an exact configured origin, never forwarded Host.
      const origin = request.headers.origin;
      if ((origin && origin !== (options.publicOrigin ?? `http://${request.headers.host}`))
        || (options.publicOrigin && !['GET', 'HEAD'].includes(request.method ?? '') && origin !== options.publicOrigin)) {
        throw new StoreError(403, 'ACCESS_DENIED', 'Use the application origin.');
      }
      if (options.includeFixtures === false && pathname.startsWith('/api/fixtures')) throw new StoreError(404, 'INVALID_REQUEST', 'Fixture routes are disabled.');
      if (request.method === 'GET' && pathname === '/api/health') {
        return json(response, 200, { status: 'ok', contractVersion: CONTRACT_VERSION, scopeStatus: store.getDesign() ? 'selected' : 'not_selected', providerConfigured: Boolean(selected), executionMode: available ? 'live' : 'unavailable' });
      }
      if (request.method === 'GET' && pathname === '/api/bootstrap') {
        return json(response, 200, BootstrapSchema.parse({
          contractVersion: CONTRACT_VERSION, scopeStatus: store.getDesign() ? 'selected' : 'not_selected', executionMode: available ? 'live' : 'unavailable',
          design: store.getDesign(), requirements: store.getRequirements(), runs: store.listRuns(), candidates: store.listCandidates(),
          unavailableReason: available ? null : selected?.baselineOnly ? 'This numeric slice supports resize runs from the saved baseline before acceptance only.' : store.getDesign() ? 'The engineering runtime and generation provider are unavailable.' : 'A design is not selected and the engineering runtime is unavailable.',
        }));
      }
      if (request.method === 'GET' && pathname === '/api/reference' && options.reference) {
        return json(response, 200, ReferenceResponseSchema.parse({ contractVersion: CONTRACT_VERSION, reference: await options.reference.describe() }));
      }
      const referenceRoute = /^\/api\/reference\/artifacts\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && referenceRoute && options.reference) {
        const reference = await options.reference.describe();
        const { artifact, bytes } = await options.reference.read(referenceRoute[1]!);
        response.writeHead(200, { 'Content-Type': artifact.mediaType, 'Content-Length': bytes.length,
          'Content-Disposition': `attachment; filename="${artifact.fileName}"`, 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'X-WorldKinetics-Applicability': reference.provenance,
          'X-WorldKinetics-Revision': reference.revisionId });
        return response.end(bytes);
      }
      if (request.method === 'GET' && pathname === '/api/fixtures/run') return json(response, 200, fixtureRun);
      if (request.method === 'GET' && pathname === '/api/fixtures/events') return json(response, 200, { contractVersion: CONTRACT_VERSION, events: [JSON.parse(await readFile(path.join(root, 'fixtures/api/v2/event.fixture.json'), 'utf8'))] });
      if (request.method === 'GET' && pathname === '/api/fixtures/bootstrap') {
        const state = url.searchParams.get('state') ?? 'reviewable';
        if (!['reviewable', 'rejected'].includes(state)) throw new StoreError(400, 'INVALID_REQUEST', 'Invalid fixture state.');
        return json(response, 200, state === 'rejected' ? fixtureRejected : fixture);
      }
      if (request.method === 'POST' && pathname === '/api/runs') {
        const parsed = RunRequestSchema.safeParse(await readRequest(request));
        if (!parsed.success) throw new StoreError(400, 'INVALID_REQUEST', 'Request does not match the shared contract. Check version, IDs, units and instruction.');
        const retry = store.getRunRetry(parsed.data);
        if (retry) return json(response, 200, { contractVersion: CONTRACT_VERSION, ...retry });
        if (!available) {
          throw new StoreError(503, 'TOOL_UNAVAILABLE', safeError('TOOL_UNAVAILABLE').message);
        }
        const { run, reused } = options.dispatchRun
          ? await options.dispatchRun(store, parsed.data, runId => executor.execute(runId))
          : await store.enqueueRun(parsed.data);
        if (!reused && !options.dispatchRun) queueMicrotask(() => { void executor.execute(run.runId); });
        return json(response, reused ? 200 : 202, { contractVersion: CONTRACT_VERSION, reused, run });
      }
      const updateRoute = /^\/api\/designs\/([^/]+)\/requirements$/.exec(pathname);
      if (request.method === 'PATCH' && updateRoute) {
        const parsed = RequirementsUpdateRequestSchema.safeParse(await readRequest(request));
        if (!parsed.success) throw new StoreError(400, 'INVALID_REQUEST', 'Invalid request.');
        if (store.getDesign()?.designId !== updateRoute[1]) throw new StoreError(409, 'IDENTITY_CONFLICT', 'Design identity mismatch.');
        return json(response, 200, { contractVersion: CONTRACT_VERSION, ...await store.updateRequirements(parsed.data) });
      }
      const packageRoute = /^\/api\/revisions\/([^/]+)\/package$/.exec(pathname);
      if (request.method === 'POST' && packageRoute) {
        const parsed = PackageRequestSchema.safeParse(await readRequest(request));
        if (!parsed.success || !IdSchema.safeParse(packageRoute[1]).success) throw new StoreError(400, 'INVALID_REQUEST', 'Invalid package request.');
        if (packageGate.busy) throw new StoreError(503, 'EXPORT_FAILED', 'Another package is being prepared.');
        packageGate.busy = true;
        try {
          const result = await buildPrototypePackage(store, artifacts, options.reference, packageRoute[1]!, parsed.data);
          store.assertCurrentExport(packageRoute[1]!, result.identity);
          response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': result.bytes.length,
            'Content-Disposition': `attachment; filename="${result.fileName}"`, 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', [PACKAGE_HEADERS.contractVersion]: CONTRACT_VERSION,
            [PACKAGE_HEADERS.requestId]: parsed.data.requestId, [PACKAGE_HEADERS.revisionId]: packageRoute[1]!,
            [PACKAGE_HEADERS.acceptanceId]: parsed.data.acceptanceId, [PACKAGE_HEADERS.manifestId]: parsed.data.manifestId,
            [PACKAGE_HEADERS.manifestHash]: parsed.data.manifestHash, [PACKAGE_HEADERS.sha256]: result.sha256,
            [PACKAGE_HEADERS.applicability]: 'current' });
          return response.end(result.bytes);
        } finally { packageGate.busy = false; }
      }
      const revisionRoute = /^\/api\/revisions\/([^/]+)\/(accept|export)$/.exec(pathname);
      if (request.method === 'POST' && revisionRoute) {
        const body = await readRequest(request);
        if (revisionRoute[2] === 'accept') {
          const parsed = AcceptanceRequestSchema.safeParse(body);
          if (!parsed.success) throw new StoreError(400, 'INVALID_REQUEST', 'Invalid request.');
          if (parsed.data.candidateRevisionId !== revisionRoute[1]) throw new StoreError(409, 'IDENTITY_CONFLICT', 'Revision identity mismatch.');
          return json(response, 200, { contractVersion: CONTRACT_VERSION, ...await store.acceptRevision(parsed.data) });
        }
        const parsed = ExportRequestSchema.safeParse(body);
        if (!parsed.success) throw new StoreError(400, 'INVALID_REQUEST', 'Invalid request.');
        return json(response, 200, { contractVersion: CONTRACT_VERSION, ...await store.exportRevision(revisionRoute[1]!, parsed.data) });
      }
      if (request.method === 'GET' && pathname === '/api/events') {
        const after = url.searchParams.get('after') ?? '0';
        if (!/^\d+$/.test(after)) throw new StoreError(400, 'INVALID_REQUEST', 'Invalid cursor.');
        return json(response, 200, { contractVersion: CONTRACT_VERSION, events: store.getEvents(undefined, Number(after)) });
      }
      if (request.method === 'GET' && pathname === '/api/runs') return json(response, 200, { contractVersion: CONTRACT_VERSION, runs: store.listRuns() });
      if (request.method === 'GET' && pathname === '/api/acceptances') {
        return json(response, 200, AcceptanceHistorySchema.parse({
          contractVersion: CONTRACT_VERSION, acceptances: store.listAcceptances(), manifests: store.listManifests(),
        }));
      }
      const resource = /^\/api\/(candidates|acceptances|manifests)\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && resource) {
        if (!IdSchema.safeParse(resource[2]).success) throw new StoreError(404, 'INVALID_REQUEST', 'Unknown identity.');
        const value = resource[1] === 'candidates' ? store.getCandidate(resource[2]!) : resource[1] === 'acceptances' ? store.getAcceptance(resource[2]!) : store.getManifest(resource[2]!);
        if (!value) throw new StoreError(404, 'INVALID_REQUEST', 'Unknown identity.');
        return json(response, 200, value);
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
        const fixtureArtifacts = options.includeFixtures === false ? [] : [...fixture.candidates.flatMap(c => c.artifacts), ...fixtureRejected.candidates.flatMap(c => c.artifacts)];
        const artifact = id.success ? [...store.listCandidates().flatMap(c => c.artifacts), ...fixtureArtifacts].find(item => item.artifactId === id.data) : undefined;
        if (!artifact) throw new StoreError(404, 'ARTIFACT_NOT_FOUND', 'Artifact not found.');
        const bytes = artifact.executionMode === 'fixture' ? Buffer.from(fixtureBytes[artifact.artifactId]!) : await artifacts.read(artifact);
        response.writeHead(200, {
          'Content-Type': artifact.mediaType, 'Content-Length': bytes.length,
          'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
          'X-WorldKinetics-Applicability': artifact.executionMode === 'fixture' ? 'fixture' : store.getDesign()?.acceptedRevisionId === artifact.revisionId && store.getDesign()?.acceptedRequirementsMatch ? 'current' : 'historical',
          'X-WorldKinetics-Revision': artifact.revisionId, 'X-WorldKinetics-Execution': artifact.executionMode,
        });
        return response.end(bytes);
      }
      if (request.method === 'GET' && pathname !== '/api' && !pathname.startsWith('/api/')) {
        // Check the raw path before URL parsing can normalize encoded dot segments.
        const asset = await readPublicFile(options.clientDir ?? path.join(root, 'dist/client'), (request.url ?? '/').split('?')[0]!);
        if (asset) {
          response.writeHead(200, { 'Content-Type': asset.mediaType, 'Content-Length': asset.content.length, 'X-Content-Type-Options': 'nosniff' });
          return response.end(asset.content);
        }
      }
      throw new StoreError(404, 'NOT_FOUND', 'Route not found.');
    } catch (error) {
      const known = error instanceof StoreError;
      json(response, known ? error.status : 500, {
        contractVersion: CONTRACT_VERSION,
        error: safeError(known && ErrorCodeSchema.safeParse(error.code).success ? ErrorCodeSchema.parse(error.code) : known ? 'INVALID_REQUEST' : 'EXECUTION_FAILED'),
      });
    }
  });
}
