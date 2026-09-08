import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'dist/client');
await mkdir(destination, { recursive: true });
const manifest: Record<string, string> = {};
for (const name of ['index.html', 'theme.css', 'theme.js', 'mark.svg']) {
  const source = path.join(root, 'src/client', name);
  await copyFile(source, path.join(destination, name));
  manifest[name] = createHash('sha256').update(await readFile(source)).digest('hex');
}
await writeFile(path.join(root, 'dist/client-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Built four FRONTEND-owned static assets into dist/client. Product scope remains not selected.');
