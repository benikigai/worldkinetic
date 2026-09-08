import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { isPublicSegment, publicMediaType } from '../src/server/static-files.js';
import { verifySavedHandleDemo } from '../src/shared/saved-handle-v2.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildClient(sourceDir: string, destination: string): Promise<Record<string, string>> {
  const source = path.resolve(sourceDir);
  const output = path.resolve(destination);
  if (source === output || source.startsWith(output + path.sep) || output.startsWith(source + path.sep)) {
    throw new Error('Client source and output directories must not overlap.');
  }
  // Rebuild from source so removed or newly private files cannot survive in dist.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const manifest: Record<string, string> = {};
  let workspaceEntry: string | undefined;

  async function copyDirectory(relative: string) {
    const entries = await readdir(path.join(source, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!isPublicSegment(entry.name) || entry.isSymbolicLink()) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await mkdir(path.join(output, name), { recursive: true });
        await copyDirectory(name);
      } else if (entry.isFile()) {
        if (name === 'workspace/main.ts') workspaceEntry = path.join(source, name);
        if (!publicMediaType(name)) continue;
        await copyFile(path.join(source, name), path.join(output, name));
        manifest[name] = createHash('sha256').update(await readFile(path.join(output, name))).digest('hex');
      }
    }
  }
  await copyDirectory('');
  if (workspaceEntry) {
    const bundlePath = path.join(output, 'workspace/main.js');
    await build({
      absWorkingDir: root,
      entryPoints: [workspaceEntry],
      outfile: bundlePath,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      nodePaths: [path.join(root, 'node_modules')],
      sourcemap: false,
      legalComments: 'inline',
    });
    manifest['workspace/main.js'] = createHash('sha256').update(await readFile(bundlePath)).digest('hex');
  }
  return manifest;
}

export async function buildSavedHandleAssets(sourceDir: string, destination: string): Promise<Record<string, string>> {
  const index = await readFile(path.join(sourceDir, 'saved-demo.json'));
  const demo = await verifySavedHandleDemo(JSON.parse(index.toString('utf8')));
  const files = [...demo.artifacts, demo.package];
  const manifest: Record<string, string> = {};
  for (const file of files) {
    const name = path.basename(file.href), source = path.join(sourceDir, name);
    if (!(await lstat(source)).isFile() || (await lstat(source)).isSymbolicLink()) throw new Error('Saved demo requires regular files.');
    const bytes = await readFile(source), hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== file.bytes || hash !== file.sha256) throw new Error('Saved demo artifact checksum mismatch.');
    const relative = file.href.slice(1);
    if (!publicMediaType(relative)) throw new Error('Saved demo artifact media type is not public.');
    await mkdir(path.join(destination, 'demo/handle'), { recursive: true });
    await writeFile(path.join(destination, relative), bytes);
    manifest[relative] = hash;
  }
  await writeFile(path.join(destination, 'demo/handle/saved-demo.json'), index);
  manifest['demo/handle/saved-demo.json'] = createHash('sha256').update(index).digest('hex');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = { ...await buildClient(path.join(root, 'src/client'), path.join(root, 'dist/client')),
    ...await buildSavedHandleAssets(path.join(root, 'fixtures/api/demo/curved-handle'), path.join(root, 'dist/client')) };
  await writeFile(path.join(root, 'dist/client-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Built ${Object.keys(manifest).length} public client assets into dist/client.`);
}
