import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const mediaTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.zip': 'application/zip',
  '.stl': 'model/stl',
  '.mp4': 'video/mp4',
};

export function isPublicSegment(name: string): boolean {
  return name.length > 0 && !name.startsWith('.') && !name.endsWith('-study') && !/[\\/%\x00-\x1f\x7f]/.test(name);
}

export function publicMediaType(name: string): string | undefined {
  if (/^demo\/handle\/(?:initial|refined)\.step$/.test(name)) return 'model/step';
  if (/^demo\/handle\/(?:initial|refined)-(?:source|editable)\.py$/.test(name)) return 'text/x-python';
  return mediaTypes[path.extname(name).toLowerCase()];
}

export async function readPublicFile(clientDir: string, requestPath: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(requestPath); }
  catch { return null; }
  if (!decoded.startsWith('/')) return null;
  const relative = decoded === '/' ? 'index.html'
    : ['/workspace', '/workspace/', '/brand', '/brand/', '/demo', '/demo/'].includes(decoded)
      ? `${decoded.slice(1).replace(/\/$/, '')}/index.html` : decoded.slice(1);
  const segments = relative.split('/');
  if (segments[0] === 'api' || !segments.every(isPublicSegment)) return null;
  const mediaType = publicMediaType(relative);
  if (!mediaType) return null;
  try {
    const base = await realpath(clientDir);
    let file = base;
    for (const [index, segment] of segments.entries()) {
      file = path.join(file, segment);
      const entry = await lstat(file);
      if (entry.isSymbolicLink() || (index === segments.length - 1 ? !entry.isFile() : !entry.isDirectory())) return null;
    }
    if (!(await realpath(file)).startsWith(base + path.sep)) return null;
    return { content: await readFile(file), mediaType };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}
