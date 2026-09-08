import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { RunStore } from '../../src/server/store.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Independent build and HTTP contract, preregistered before BACKEND-01 implementation.
test('build copies exact public bytes, bundles workspace TS locally and excludes studies/private sources', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wk-build-'));
  try {
    const source = path.join(dir, 'client');
    const destination = path.join(dir, 'dist/client');
    const files: Record<string, string> = {
      'index.html': '<h1>Preserved landing</h1>', 'theme.css': 'body { color: blue; }',
      'theme.js': 'window.theme = "original";', 'mark.svg': '<svg>original</svg>',
      'workspace/index.html': '<script type="module" src="/workspace/main.js"></script>',
      'workspace/workspace.css': 'canvas { display: block; }',
      'workspace/assets/reference.stl': 'solid reference\nendsolid reference',
      'brand/index.html': '<h1>Brand</h1>', 'brand/kit.zip': 'zip-fixture-bytes',
      'workspace/main.ts': 'import { Scene } from "three"; const scene: Scene = new Scene(); globalThis.console.log(scene.type);',
      'brand/globe-study/private.svg': '<svg>unselected</svg>',
      'brand/wireframe-study/private.html': 'unselected', '.env': 'SYNTHETIC_SENTINEL',
      'workspace/notes.md': 'non-public notes',
    };
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await writeFile(path.join(source, name), text);
    }
    await writeFile(path.join(dir, 'outside.svg'), '<svg>outside sentinel</svg>');
    await symlink(path.join(dir, 'outside.svg'), path.join(source, 'outside.svg'));
    const module = await import('../../scripts/build.js') as Record<string, unknown>;
    assert.equal(typeof module.buildClient, 'function', 'Export buildClient(source, destination) for independent build verification');
    await (module.buildClient as (source: string, destination: string) => Promise<unknown>)(source, destination);
    for (const [name, text] of Object.entries(files).filter(([name]) => !name.endsWith('.ts') && !name.endsWith('.md') && !name.includes('-study/') && !name.startsWith('.'))) {
      assert.equal(hash(await readFile(path.join(destination, name))), hash(Buffer.from(text)), name);
    }
    const bundle = await readFile(path.join(destination, 'workspace/main.js'), 'utf8');
    assert.ok(bundle.length > 1000, 'Three.js must be bundled from the pinned local dependency');
    assert.doesNotMatch(bundle, /(?:from\s*|import\s*\()["'](?:three|https?:\/\/)/, 'No unresolved package or CDN imports');
    for (const name of ['workspace/main.ts', 'workspace/notes.md', '.env', 'outside.svg', 'brand/globe-study/private.svg', 'brand/wireframe-study/private.html']) {
      await assert.rejects(readFile(path.join(destination, name)), { code: 'ENOENT' }, name);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('HTTP serves built workspace and nested assets, preserves root bytes and rejects private paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wk-static-'));
  const clientDir = path.join(dir, 'client');
  const files: Record<string, [string, string]> = {
    'index.html': ['<h1>Landing</h1>', 'text/html'],
    'theme.css': ['body{}', 'text/css'], 'theme.js': ['window.x=1', 'text/javascript'],
    'mark.svg': ['<svg/>', 'image/svg+xml'],
    'workspace/index.html': ['<h1>Workspace</h1>', 'text/html'],
    'workspace/main.js': ['console.log("workspace")', 'text/javascript'],
    'workspace/workspace.css': ['canvas{}', 'text/css'],
    'workspace/assets/reference.stl': ['solid test\nendsolid test', 'model/stl'],
    'brand/index.html': ['<h1>Brand</h1>', 'text/html'],
    'brand/kit.zip': ['ZIP_BYTES', 'application/zip'],
  };
  for (const [name, [text]] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(clientDir, name)), { recursive: true });
    await writeFile(path.join(clientDir, name), text);
  }
  await writeFile(path.join(dir, 'secret.txt'), 'SYNTHETIC_OUTSIDE_SENTINEL');
  await symlink(path.join(dir, 'secret.txt'), path.join(clientDir, 'leak.svg'));
  await writeFile(path.join(clientDir, '.env'), 'SYNTHETIC_PRIVATE_SENTINEL');
  const store = new RunStore(path.join(dir, 'runtime'), null);
  const server = (createApp as Function)(store, dir, null, undefined, { clientDir });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, [text, mime]] of Object.entries(files)) {
      const url = name === 'index.html' ? '/' : '/' + name;
      const response = await fetch(base + url);
      assert.equal(response.status, 200, url);
      assert.ok(response.headers.get('content-type')?.startsWith(mime), url);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(Buffer.from(text)), url);
    }
    for (const url of ['/workspace', '/workspace/', '/brand', '/brand/']) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200, url);
      assert.equal(await response.text(), files[url.startsWith('/workspace') ? 'workspace/index.html' : 'brand/index.html'][0]);
    }
    for (const url of ['/leak.svg', '/.env', '/%2eenv', '/workspace/%2e%2e/%2e%2e/secret.txt', '/workspace/%2F..%2F..%2Fsecret.txt', '/workspace/missing.js', '/workspace/%00.js']) {
      const response = await fetch(base + url);
      assert.equal(response.status, 404, url);
      assert.doesNotMatch(await response.text(), /SYNTHETIC_.*SENTINEL/, url);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
