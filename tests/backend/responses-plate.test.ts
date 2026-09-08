import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as c from '../../src/shared/contracts-v2.js';

// Supervisor acceptance bootstrap. Provider and CAD are injected here; no paid calls or geometry execution.
const plannerPath = '../../src/server/responses-astra.js';
const applicationPath = '../../src/server/plate-app.js';
const proposal = { kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: 36 } } };
const responseBody = (patch = {}) => ({ id: 'resp_synthetic', object: 'response', model: 'gpt-6-astra', status: 'completed',
  output: [{ type: 'message', phase: 'final_answer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposal), annotations: [] }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, ...patch });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function allText(directory: string): Promise<string> {
  const values = await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? allText(file) : (await readFile(file)).toString();
  }));
  return values.join('\n');
}

test('Responses planner uses bounded structured output and retains sanitized actual response identity', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wk-responses-test-'));
  try {
    const module = await import(plannerPath);
    const requirements = await c.createRequirements({ designId: 'plate', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 36 });
    const fixture = JSON.parse(await readFile(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url), 'utf8'));
    const run = { ...fixture.runs[0], runId: 'run_responses_test', designId: 'plate', inputRevisionId: 'baseline_50', instruction: 'Apply the confirmed length.' };
    let calls = 0;
    const planner = new module.ResponsesAstraPlanner({ apiKey: 'synthetic-secret-never-log', runtimeDir: dir,
      fetchImpl: async (url: string, options: RequestInit) => {
        calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-secret-never-log');
        const body = JSON.parse(String(options.body));
        assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.store, false);
        assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
        assert(body.max_output_tokens > 0 && body.max_output_tokens <= 4096);
        assert(!body.tools?.length); assert.equal(body.background, false);
        assert(JSON.stringify(body).includes(requirements.setupHash));
        assert(options.signal instanceof AbortSignal);
        return new Response(JSON.stringify(responseBody()), { status: 200 });
      } });
    assert.deepEqual(await planner.propose(run, new AbortController().signal, requirements), proposal);
    assert.equal(calls, 1);
    const receipt = JSON.parse(await readFile(path.join(dir, 'runs', run.runId, 'provider', 'receipt.json'), 'utf8'));
    assert.equal(receipt.responseId, 'resp_synthetic');
    assert.equal(receipt.requestedModel, 'gpt-6-astra'); assert.equal(receipt.reportedModel, 'gpt-6-astra');
    assert.equal(receipt.proposalHash, await c.hashCanonical(proposal));
    for (const patch of [{ status: 'incomplete' }, { model: 'another-model' }, { output: [] },
      { output: [{ type: 'function_call', name: 'shell', arguments: '{}' }] },
      { output: [{ type: 'message', phase: 'commentary', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: JSON.stringify(proposal) }] }] },
      { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] }]) {
      const bad = new module.ResponsesAstraPlanner({ apiKey: 'synthetic-secret-never-log', runtimeDir: dir,
        fetchImpl: async () => new Response(JSON.stringify(responseBody(patch)), { status: 200 }) });
      await assert.rejects(bad.propose({ ...run, runId: 'bad_' + crypto.randomUUID() }, new AbortController().signal, requirements));
    }
    const failed = new module.ResponsesAstraPlanner({ apiKey: 'synthetic-secret-never-log', runtimeDir: dir,
      fetchImpl: async () => new Response('synthetic-secret-never-log', { status: 401 }) });
    await assert.rejects(failed.propose({ ...run, runId: 'http_failure' }, new AbortController().signal, requirements), error => !String(error).includes('synthetic-secret-never-log'));
    assert.equal((await allText(dir)).includes('synthetic-secret-never-log'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('plate application serves registered reference bytes and dispatches one retry-safe request with a new output directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wk-plate-app-'));
  let server: any;
  try {
    const module = await import(applicationPath);
    let providerCalls = 0, toolCalls = 0;
    const app = await module.createPlateApplication({ runtimeDir: dir, apiKey: 'synthetic-secret-never-log',
      fetchImpl: async () => { providerCalls++; return new Response(JSON.stringify(responseBody()), { status: 200 }); },
      tool: async (input: c.ToolInput) => {
        toolCalls++;
        await assert.rejects(stat(input.outputDir), { code: 'ENOENT' });
        assert((await stat(path.dirname(input.outputDir))).isDirectory());
        assert.equal(input.inputRevisionId, 'baseline_50');
        const ref = input.inputArtifacts.find(a => a.kind === 'reference')!;
        assert.equal(digest(await readFile(ref.path)), input.requirements.referenceHash);
        const r = input.requirements;
        return { contractVersion: c.CONTRACT_VERSION, runId: input.runId, requestId: input.requestId, designId: input.designId,
          inputRevisionId: input.inputRevisionId, outputRevisionId: input.outputRevisionId, attemptId: input.attemptId, units: 'mm',
          ...Object.fromEntries(['requirementsId','requirementsVersion','registryId','registryHash','setupId','setupHash','referenceHash','validatorVersion'].map(k => [k, (r as any)[k]])),
          requirements: r, proposal: input.proposal, proposalHash: await c.hashCanonical(input.proposal), executionMode: 'unavailable', status: 'unavailable',
          engine: null, sourceSha256: null, geometryHash: null, checkBundleHash: null, checks: [], artifacts: [], error: c.safeError('TOOL_UNAVAILABLE') };
      } });
    server = app.server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const refResponse = await fetch(url + '/api/reference'); assert.equal(refResponse.status, 200);
    const reference = (await refResponse.json() as any).reference;
    assert.equal(reference.revisionId, 'baseline_50'); assert.equal(reference.provenance, 'saved_reference');
    assert.equal(reference.units, 'mm');
    for (const artifact of reference.artifacts) {
      assert(!('path' in artifact)); const download = await fetch(url + artifact.href); assert.equal(download.status, 200);
      const bytes = new Uint8Array(await download.arrayBuffer()); assert.equal(bytes.length, artifact.bytes); assert.equal(digest(bytes), artifact.sha256);
    }
    assert(reference.artifacts.some((a: any) => a.mediaType === 'model/step'));
    assert(reference.artifacts.some((a: any) => a.mediaType === 'model/stl'));
    const initial = c.BootstrapSchema.parse(await (await fetch(url + '/api/bootstrap')).json());
    const update = { contractVersion: c.CONTRACT_VERSION, requestId: 'confirm_36', expectedStateVersion: initial.design!.stateVersion,
      expectedRequirementsVersion: initial.requirements!.requirementsVersion, setupId: 'resize_centered_v1', confirmedIntent: { lengthMm: 36 }, userActionId: 'test_confirm' };
    const changed = await fetch(url + '/api/designs/plate/requirements', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) });
    assert.equal(changed.status, 200);
    const request = { contractVersion: c.CONTRACT_VERSION, requestId: 'one_request', designId: 'plate', inputRevisionId: 'baseline_50', requirementsVersion: 2,
      setupId: 'resize_centered_v1', units: 'mm', instruction: 'Apply the confirmed length.' };
    const post = () => fetch(url + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const first = await post(); assert.equal(first.status, 202); const body = await first.json() as any;
    for (let i = 0; i < 100 && !['failed','completed'].includes(app.store.getRun(body.run.runId).status); i++) await delay(10);
    assert.equal(app.store.getRun(body.run.runId).status, 'failed'); assert.equal(toolCalls, 1); assert.equal(providerCalls, 1);
    const retry = await post(); assert.equal(retry.status, 200); assert.equal((await retry.json() as any).run.runId, body.run.runId);
    assert.equal(toolCalls, 1); assert.equal(providerCalls, 1); assert.equal(app.store.getDesign().acceptedRevisionId, null);
  } finally {
    if (server?.listening) await new Promise<void>(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
