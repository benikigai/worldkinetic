// OUTSIDE_WRAPPER: synthetic byte transport checks, not generated CAD evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedBytes } from '../../src/client/workspace/recorded-files.js';
import { sha256 } from '../../src/shared/contracts-v2.js';
const bytes = new Uint8Array([1, 2, 3, 4]);
test('recorded asset is fetched without API/session credentials and exact bytes verified', async () => {
  const result = await recordedBytes(async (url, init) => {
    assert.equal(url, '/demo/handle/refined.stl'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    return new Response(bytes);
  }, '/demo/handle/refined.stl', bytes.length, await sha256(bytes));
  assert.deepEqual(new Uint8Array(result), bytes);
});
test('wrong hashes, truncated bytes and unavailable saved files never become sample success', async () => {
  await assert.rejects(recordedBytes(async () => new Response(bytes), '/demo/handle/refined.stl', 4, '0'.repeat(64)), /checksum/);
  await assert.rejects(recordedBytes(async () => new Response(bytes), '/demo/handle/refined.stl', 3, await sha256(bytes)), /size/);
  await assert.rejects(recordedBytes(async () => new Response(bytes), '/demo/handle/refined.stl', 5, await sha256(bytes)), /checksum/);
  await assert.rejects(recordedBytes(async () => new Response('', { status: 404 }), '/demo/handle/refined.stl', 4, await sha256(bytes)), /unavailable/);
});
test('recorded file transport rejects API, external and traversal paths before fetching', async () => {
  let calls = 0; const fetcher = async () => { calls++; return new Response(bytes); };
  for (const href of ['/api/artifacts/file', 'https://elsewhere.example/file', '/demo/handle/../../api/bootstrap']) {
    await assert.rejects(recordedBytes(fetcher, href, 4, await sha256(bytes)), /identity/);
  }
  assert.equal(calls, 0);
});

test('actual saved manifest supplies distinct approved Before and After files with no live API', async () => {
  const { readFile } = await import('node:fs/promises');
  const { loadRecordedDemo, recordedView } = await import('../../src/client/workspace/recorded-files.js');
  const raw = await readFile(new URL('../../fixtures/api/demo/curved-handle/saved-demo.json', import.meta.url), 'utf8');
  const demo = await loadRecordedDemo(async path => { assert.equal(path, '/demo/handle/saved-demo.json'); return new Response(raw); });
  const before = recordedView(demo, 'before'), after = recordedView(demo, 'after');
  assert.notEqual(before.manifest.revisionId, after.manifest.revisionId);
  assert.notEqual(before.previewFile.sha256, after.previewFile.sha256);
  assert.equal(before.manifest.checks.length, 8); assert.equal(after.manifest.checks.length, 9);
  assert.ok(before.files.every(file => file.id !== 'approved-package'));
  assert.equal(after.files[0].id, 'approved-package');
  assert.equal(after.files[0].sha256, demo.package.sha256);
  assert.ok(after.files.every(file => file.href.startsWith('/demo/handle/')));
});
test('tampered recorded artifact mapping fails original acceptance verification', async () => {
  const { readFile } = await import('node:fs/promises');
  const { loadRecordedDemo } = await import('../../src/client/workspace/recorded-files.js');
  const raw = JSON.parse(await readFile(new URL('../../fixtures/api/demo/curved-handle/saved-demo.json', import.meta.url), 'utf8'));
  raw.artifacts[0].sha256 = '0'.repeat(64);
  await assert.rejects(loadRecordedDemo(async () => new Response(JSON.stringify(raw))), /identity mismatch/);
});
