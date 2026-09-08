import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { sha256, verifyToolInput, type ToolInputData } from '../shared/contracts-v2.js';
import { HANDLE_DATUM_CANONICAL_JSON } from '../shared/requirements-handle-v2.js';

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export async function verifyFile(filePath: string, expectedHash: string, canonicalBytes?: string): Promise<void> {
  const absolute = path.resolve(filePath);
  const entry = await lstat(absolute);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_ARTIFACT_BYTES) throw new Error('Dispatch artifact must be a bounded regular nonsymlink file.');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_ARTIFACT_BYTES || before.ino !== entry.ino || before.dev !== entry.dev) throw new Error('Dispatch artifact must be a bounded regular file.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error('Dispatch artifact changed while reading.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || await sha256(bytes) !== expectedHash) throw new Error('Dispatch artifact hash mismatch or concurrent modification.');
    if (canonicalBytes !== undefined && !bytes.equals(Buffer.from(canonicalBytes, 'utf8'))) throw new Error('Dispatch datum must contain the exact fixed canonical bytes.');
  } finally {
    await handle.close();
  }
}

/** Byte integrity only. Does not run source/CAD or establish store acceptance. */
export async function verifyDispatchArtifacts(input: unknown): Promise<ToolInputData> {
  const data = await verifyToolInput(input);
  const reference = data.referenceArtifact;
  if (reference) {
    await verifyFile(reference.path, reference.sha256);
    if (reference.datumSpec) {
      await verifyFile(reference.datumSpec.path, reference.datumSpec.sha256,
        data.requirements.registryId === 'handle_sample_v1' ? HANDLE_DATUM_CANONICAL_JSON : undefined);
    }
  }
  for (const artifact of data.inputArtifacts) await verifyFile(artifact.path, artifact.sha256);
  return data;
}
