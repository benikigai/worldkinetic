import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from './worker.mjs';
const env = { API_ORIGIN: 'https://dedicated.example', UPSTREAM_KEY: 'test-only-key', ASSETS: { fetch: async () => new Response('static') } };

test('static routes retain the assets binding', async () => {
  assert.equal(await (await worker.fetch(new Request('https://worldkinetics.app/demo/'), env)).text(), 'static');
});
for (const config of [{}, { API_ORIGIN: 'https://dedicated.example' }, { API_ORIGIN: 'http://localhost:4318', UPSTREAM_KEY: 'test-only-key' }, { API_ORIGIN: 'https://user:password@example.com', UPSTREAM_KEY: 'test-only-key' }]) {
  test('unconfigured or unsafe upstream fails closed', async t => {
    const call = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
    assert.equal((await worker.fetch(new Request('https://worldkinetics.app/api/runs', { method: 'POST', body: '{}' }), config)).status, 503);
    assert.equal(call.mock.callCount(), 0);
  });
}
test('exact custom request and trusted headers reach only the configured origin', async t => {
  t.mock.method(globalThis, 'fetch', async (target, init) => {
    assert.equal(String(target), 'https://dedicated.example/api/runs?test=1');
    assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.get('cookie'), 'session=test');
    assert.equal(init.headers.get('origin'), 'https://worldkinetics.app');
    assert.equal(init.headers.get('x-worldkinetics-workspace'), 'workspace_test');
    assert.equal(init.headers.get('X-WorldKinetics-Upstream-Key'), 'test-only-key');
    assert.equal(init.headers.get('X-WorldKinetics-Client-IP'), '192.0.2.1');
    assert.equal(init.headers.get('authorization'), null);
    assert.equal(await new Response(init.body).text(), '{"instruction":"thicker in the middle"}');
    return new Response('{"status":"queued"}', { status: 202 });
  });
  const response = await worker.fetch(new Request('https://worldkinetics.app/api/runs?test=1', { method: 'POST', body: '{"instruction":"thicker in the middle"}', headers: { Cookie: 'session=test', Origin: 'https://worldkinetics.app', 'X-WorldKinetics-Workspace': 'workspace_test', 'CF-Connecting-IP': '192.0.2.1', 'X-WorldKinetics-Upstream-Key': 'forged', 'X-WorldKinetics-Client-IP': 'forged', Authorization: 'forged' } }), env);
  assert.equal(response.status, 202);
});
test('streams exact bytes, download identity and session cookie without caching', async t => {
  const bytes = new Uint8Array([0, 255, 80, 75]);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Content-Length': '4', 'Content-Disposition': 'attachment; filename="package.zip"', 'X-WorldKinetics-Revision': 'test-revision', 'Set-Cookie': 'session=test; HttpOnly; Secure; SameSite=Strict; Path=/', 'Cache-Control': 'public', 'X-WorldKinetics-Upstream-Key': 'test-only-key' } }));
  const response = await worker.fetch(new Request('https://worldkinetics.app/api/revisions/test/package', { method: 'POST', body: '{}' }), env);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('Content-Length'), '4');
  assert.equal(response.headers.get('X-WorldKinetics-Revision'), 'test-revision');
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-WorldKinetics-Upstream-Key'), null);
});
test('upstream auth errors pass through, redirects and failures fail closed', async t => {
  const call = t.mock.method(globalThis, 'fetch', async () => new Response('Unauthorized', { status: 401 }));
  assert.equal((await worker.fetch(new Request('https://worldkinetics.app/api/session'), env)).status, 401);
  call.mock.mockImplementation(async () => Response.redirect('https://elsewhere.example', 302));
  const redirect = await worker.fetch(new Request('https://worldkinetics.app/api/session'), env);
  assert.equal(redirect.status, 503); assert.equal(redirect.headers.get('Location'), null);
  call.mock.mockImplementation(async () => { throw new Error('private origin detail'); });
  const failure = await worker.fetch(new Request('https://worldkinetics.app/api/session'), env);
  assert.equal(await failure.text(), 'Demo service unavailable.');
});

test('www and HTTP apex redirect paths and queries before assets or API forwarding', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Redirect must not reach API'); });
  let assets = 0;
  const config = { ...env, ASSETS: { fetch: async () => { assets++; throw new Error('Redirect must precede assets'); } } };
  for (const base of ['http://worldkinetics.app', 'http://www.worldkinetics.app', 'https://www.worldkinetics.app']) {
    for (const suffix of ['/', '/workspace/?mode=live&idea=curved%20handle', '/demo/handle-demo.mp4', '/api/session?return=%2Fworkspace%2F']) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = await worker.fetch(new Request(base + suffix, { method }), config);
        assert.equal(response.status, 308);
        assert.equal(response.headers.get('Location'), 'https://worldkinetics.app' + suffix);
        assert.equal(response.headers.get('Set-Cookie'), null);
      }
    }
  }
  assert.equal(network.mock.callCount(), 0); assert.equal(assets, 0);
});

test('canonical HTTPS and unrelated preview hosts do not acquire redirect loops', async () => {
  for (const base of ['https://worldkinetics.app', 'https://worldkinetics-placeholder.benjamin-shyong.workers.dev', 'http://localhost:8787', 'https://www.worldkinetics.app.example']) {
    const response = await worker.fetch(new Request(base + '/workspace/?mode=live'), env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Location'), null);
    assert.equal(await response.text(), 'static');
  }
});

test('deployed routes cover both hosts and all assets pass the redirect check', () => {
  const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.binding, 'ASSETS');
  assert.deepEqual(config.routes, [
    { pattern: 'worldkinetics.app', custom_domain: true },
    { pattern: 'www.worldkinetics.app', custom_domain: true },
  ]);
});
