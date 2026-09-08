import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { isPublicSegment, publicMediaType } from '../src/server/static-files.js';

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildClient(path.join(root, 'src/client'), path.join(root, 'dist/client'));
  await writeFile(path.join(root, 'dist/client-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Built ${Object.keys(manifest).length} public client assets into dist/client.`);
}
