// OUTSIDE_WRAPPER: validates preserved real evidence and bytes, without invoking CAD or a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../src/shared/contracts.js';
import { verifySavedHandleDemo } from '../../src/shared/saved-handle-v2.js';
import { buildSavedHandleAssets } from '../../scripts/build.js';
import { createApp } from '../../src/server/app.js';
import { RunStore } from '../../src/server/store.js';
const source = fileURLToPath(new URL('../../fixtures/api/demo/curved-handle', import.meta.url));
const data = () => readFile(path.join(source, 'saved-demo.json'), 'utf8').then(JSON.parse);

test('saved handle preserves both actual acceptances and exact eight CAD files plus the original dependent ZIP', async () => {
  const demo = await verifySavedHandleDemo(await data());
  assert.equal(demo.provenance, 'recorded_product_run');
  assert.equal(demo.sourceCommit, '5be4b7a5c8211a8eb4b537c20bc60766378cce32');
  assert.equal(demo.initial.revisionId, 'revision_cfa10ddf-aab7-462f-9d6d-7013dd92a9e3');
  assert.equal(demo.refined.revisionId, 'revision_e1ec294f-13df-4e88-a32a-cfbf631120b2');
  assert.equal(demo.history.manifests.find(m => m.revisionId === demo.initial.revisionId)!.checks.length, 8);
  assert.equal(demo.history.manifests.find(m => m.revisionId === demo.refined.revisionId)!.checks.length, 9);
  for (const file of [...demo.artifacts, demo.package]) {
    const bytes = await readFile(path.join(source, path.basename(file.href)));
    assert.equal(bytes.length, file.bytes); assert.equal(await sha256(bytes), file.sha256);
  }
  assert.equal(demo.package.sha256, '7f11b9fa4d2e52c735746ec22f202f563f396024ce32675b50557d69d7e7dcfa');
  assert.equal(demo.package.bytes, 5906945);
});

test('recorded metadata rejects swapped stages, stale acceptance, altered evidence and private paths', async () => {
  for (const mutate of [
    (d: any) => { d.refined = d.initial; },
    (d: any) => { d.package.acceptanceId = d.initial.acceptanceId; },
    (d: any) => { d.history.manifests[0].checks[0].state = 'failed'; },
    (d: any) => { d.artifacts[0].sha256 = '0'.repeat(64); },
    (d: any) => { d.artifacts[0].href = '/api/artifacts/private'; },
    (d: any) => { d.artifacts[0].href = '/demo/handle/../private.py'; },
    (d: any) => { d.provenance = 'live'; },
  ]) { const changed = await data(); mutate(changed); await assert.rejects(verifySavedHandleDemo(changed)); }
});

test('static saved files are served without a session while API state remains empty', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wk-saved-http-')), clientDir = path.join(dir, 'client');
  const manifest = await buildSavedHandleAssets(source, clientDir);
  assert.equal(Object.keys(manifest).length, 10);
  const store = new RunStore(path.join(dir, 'runtime'), null), server = createApp(store, dir, null, undefined, { clientDir });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const [file, expected] of Object.entries(manifest)) {
      const response = await fetch(base + '/' + file); assert.equal(response.status, 200);
      assert.equal(await sha256(new Uint8Array(await response.arrayBuffer())), expected);
    }
    assert.equal((await fetch(base + '/demo/handle/unknown.py')).status, 404);
    assert.equal((await fetch(base + '/server/public-demo.ts')).status, 404);
    assert.equal((await fetch(base + '/api/session')).status, 404);
    assert.deepEqual(store.listRuns(), []); assert.deepEqual(store.listAcceptances(), []);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true }); }
});

test('build fails on damaged bytes and symlinks, and never copies unlisted files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wk-saved-build-')), copy = path.join(dir, 'source'), output = path.join(dir, 'output');
  try {
    await cp(source, copy, { recursive: true });
    await writeFile(path.join(copy, 'private.json'), '{"private":"synthetic sentinel"}');
    await buildSavedHandleAssets(copy, output);
    assert(!(await readdir(path.join(output, 'demo/handle'))).includes('private.json'));
    const file = path.join(copy, 'initial.stl'), original = await readFile(file);
    await writeFile(file, 'damaged'); await assert.rejects(buildSavedHandleAssets(copy, output), /checksum/);
    await writeFile(path.join(dir, 'outside.stl'), original); await rm(file); await symlink(path.join(dir, 'outside.stl'), file);
    await assert.rejects(buildSavedHandleAssets(copy, output), /regular files/);
  } finally { await rm(dir, { recursive: true }); }
});
