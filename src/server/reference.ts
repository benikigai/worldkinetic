import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReferenceSchema, type Reference, type ReferenceArtifact } from '../shared/reference-v2.js';
import type { InputArtifact, Requirements } from '../shared/contracts.js';
import { StoreError } from './store.js';

const sourceDirectory = fileURLToPath(new URL('../../examples/plate/revised/', import.meta.url));
const files = [
  { artifactId: 'reference_plate_step', fileName: 'plate-50x35x5.step', mediaType: 'model/step',
    sha256: '9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3' },
  { artifactId: 'reference_plate_stl', fileName: 'plate-50x35x5.stl', mediaType: 'model/stl',
    sha256: 'be0f4113c8b12339f37d7a34cbb1b967b22fae6c13bbcabd156a591480dc2d4a' },
] as const;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function checkDirectory(directory: string): Promise<void> {
  let parent = directory;
  while (true) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid reference directory');
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

export async function readRegular(file: string): Promise<Buffer> {
  await checkDirectory(path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 25 * 1024 * 1024) throw new Error('Invalid reference file');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Reference changed during read');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Reference changed during read');
    return bytes;
  } finally { await handle.close(); }
}

export interface PublicReference {
  describe(): Promise<Reference>;
  read(artifactId: string): Promise<{ artifact: ReferenceArtifact; bytes: Buffer }>;
}

export class SavedPlateReference implements PublicReference {
  private constructor(readonly directory: string, private readonly reference: Reference) {}

  static async register(runtimeDir: string, requirements: Requirements): Promise<SavedPlateReference> {
    if (requirements.referenceHash !== files[0].sha256 || requirements.referenceId !== 'plate_revised_50x35x5') throw new Error('Baseline reference identity mismatch');
    const directory = path.join(runtimeDir, 'references', 'baseline_50');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await checkDirectory(directory);
    const artifacts: ReferenceArtifact[] = [];
    for (const file of files) {
      const bytes = await readRegular(path.join(sourceDirectory, file.fileName));
      if (digest(bytes) !== file.sha256) throw new Error('Canonical reference integrity failure');
      const destination = path.join(directory, file.artifactId);
      try { await writeFile(destination, bytes, { flag: 'wx', mode: 0o400 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const sealed = await readRegular(destination);
      if (sealed.length !== bytes.length || digest(sealed) !== file.sha256) throw new Error('Sealed reference integrity failure');
      artifacts.push({ ...file, bytes: bytes.length, href: `/api/reference/artifacts/${file.artifactId}` });
    }
    return new SavedPlateReference(directory, ReferenceSchema.parse({ referenceId: requirements.referenceId,
      revisionId: 'baseline_50', units: 'mm', provenance: 'saved_reference', artifacts }));
  }

  async describe(): Promise<Reference> {
    for (const artifact of this.reference.artifacts) await this.read(artifact.artifactId);
    return structuredClone(this.reference);
  }

  async read(artifactId: string): Promise<{ artifact: ReferenceArtifact; bytes: Buffer }> {
    const artifact = this.reference.artifacts.find(a => a.artifactId === artifactId);
    if (!artifact) throw new StoreError(404, 'INVALID_REQUEST', 'Unknown reference artifact.');
    try {
      const bytes = await readRegular(path.join(this.directory, artifact.artifactId));
      if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) throw new Error('Reference integrity failure');
      return { artifact: structuredClone(artifact), bytes };
    } catch { throw new StoreError(409, 'EVIDENCE_CONFLICT', 'Saved reference integrity failure.'); }
  }

  inputArtifacts(): InputArtifact[] {
    const step = this.reference.artifacts.find(a => a.mediaType === 'model/step')!;
    return [{ artifactId: step.artifactId, revisionId: this.reference.revisionId, kind: 'reference', units: 'mm',
      path: path.join(this.directory, step.artifactId), sha256: step.sha256 }];
  }
}
