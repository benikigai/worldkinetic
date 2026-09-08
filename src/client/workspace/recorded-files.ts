import { sha256 } from '../../shared/contracts-v2.js';

export async function recordedBytes(fetcher: typeof fetch, href: string, expectedBytes: number, expectedHash: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!/^\/demo\/handle\/[a-zA-Z0-9_./-]+$/.test(href) || href.split('/').some(part => part === '.' || part === '..')
    || !Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 25 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('Recorded file identity is invalid.');
  }
  const response = await fetcher(href, { credentials: 'omit', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok || response.redirected || !response.body) { await response.body?.cancel(); throw new Error('The recorded file is unavailable. Try again.'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > expectedBytes) { await reader.cancel(); throw new Error('The recorded file does not match its approved size.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (total !== expectedBytes || await sha256(bytes) !== expectedHash) throw new Error('The recorded file does not match its approved checksum.');
  return bytes.buffer;
}

export async function loadRecordedDemo(fetcher: typeof fetch, signal?: AbortSignal) {
  const { verifySavedHandleDemo } = await import('../../shared/saved-handle-v2.js');
  const response = await fetcher('/demo/handle/saved-demo.json', { credentials: 'omit', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok || response.redirected || !response.body) throw new Error('The approved example is unavailable. Reload to try again.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length;
    if (total > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Recorded evidence exceeds its size limit.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return verifySavedHandleDemo(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

export function recordedView(demo: import('../../shared/saved-handle-v2.js').SavedHandleDemo, side: 'before' | 'after') {
  const ref = side === 'before' ? demo.initial : demo.refined;
  const manifest = demo.history.manifests.find(item => item.manifestId === ref.manifestId)!;
  const preview = manifest.artifacts.find(item => item.mediaType === 'model/stl')!;
  const previewFile = demo.artifacts.find(item => item.artifactId === preview.artifactId)!;
  const files = manifest.artifacts.filter(item => item.kind !== 'source').map(item => ({
    id: item.artifactId, fileName: item.fileName, mediaType: item.mediaType,
    label: item.mediaType === 'model/stl' ? 'STL · 3D mesh' : item.mediaType === 'model/step' ? 'STEP · editable CAD' : 'Editable Python',
    ...demo.artifacts.find(file => file.artifactId === item.artifactId)!,
  })).sort((a, b) => Number(b.mediaType === 'model/stl') - Number(a.mediaType === 'model/stl'));
  if (side === 'after') files.unshift({ id: 'approved-package', artifactId: 'approved-package', fileName: `worldkinetics-${ref.revisionId}-prototype.zip`, mediaType: 'application/zip', label: 'Complete approved package · ZIP', ...demo.package });
  return { manifest, previewFile, files };
}
