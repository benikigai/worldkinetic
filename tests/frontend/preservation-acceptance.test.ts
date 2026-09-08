// OUTSIDE_WRAPPER: existing frontend assets are protected independently of backend changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the existing landing, themes, brand and reference examples retain their accepted bytes', async () => {
  const manifest = JSON.parse(await readFile(new URL('./workspace-preservation.json', import.meta.url), 'utf8')) as Record<string, string>;
  const root = new URL('../../', import.meta.url);
  for (const [path, expected] of Object.entries(manifest)) {
    const actual = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    assert.equal(actual, expected, path);
  }
});
