import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, type DispatchReferenceArtifact } from '../shared/contracts.js';
import { HANDLE_DATUM_CANONICAL_JSON, HANDLE_DATUM_SHA256 } from '../shared/requirements-handle-v2.js';
import { HandleReferenceSchema, type ReferenceArtifact } from '../shared/reference-v2.js';
import { checkDirectory, readRegular, type PublicReference } from './reference.js';
import { StoreError } from './store.js';

export interface HandleReferenceFiles { stepPath: string; previewPath: string; datumPath: string }

async function readSupplied(file: string) {
  let absolute = path.resolve(file);
  // macOS aliases are allowed; reference directories and files themselves cannot be symlinks.
  const alias = /^\/(var|tmp)(?=\/)/.exec(absolute)?.[0];
  if (alias) absolute = path.join(await realpath(alias), path.relative(alias, absolute));
  return readRegular(absolute);
}

export class SavedHandleReference implements PublicReference {
  private constructor(readonly directory: string, private readonly reference: ReturnType<typeof HandleReferenceSchema.parse>) {}

  static async register(runtimeDir: string, inputs: HandleReferenceFiles) {
    const files = [
      { artifactId: 'reference_handle_step', fileName: 'reference.step', mediaType: 'model/step', source: inputs.stepPath },
      { artifactId: 'reference_handle_stl', fileName: 'preview.stl', mediaType: 'model/stl', source: inputs.previewPath },
      { artifactId: 'reference_handle_datums', fileName: 'datums.json', mediaType: 'application/json', source: inputs.datumPath },
    ] as const;
    const supplied = await Promise.all(files.map(file => readSupplied(file.source)));
    if (!supplied[2]!.equals(Buffer.from(HANDLE_DATUM_CANONICAL_JSON))) throw new Error('Handle datums must contain the exact canonical bytes.');
    const directory = path.join(runtimeDir, 'references', 'handle_mount_reference_v1');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await checkDirectory(directory);
    const artifacts: ReferenceArtifact[] = [];
    for (const [index, file] of files.entries()) {
      const bytes = supplied[index]!, hash = await sha256(bytes);
      const destination = path.join(directory, file.fileName);
      try { await writeFile(destination, bytes, { flag: 'wx', mode: 0o400 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (!(await readRegular(destination)).equals(bytes) || !(await readSupplied(file.source)).equals(bytes)) {
        throw new Error('Handle reference bytes changed.');
      }
      artifacts.push({ artifactId: file.artifactId, fileName: file.fileName, mediaType: file.mediaType,
        bytes: bytes.length, sha256: hash, href: `/api/reference/artifacts/${file.artifactId}` });
    }
    const reference = HandleReferenceSchema.parse({ referenceId: 'handle_mount_v1', revisionId: 'handle_mount_reference_v1',
      units: 'mm', provenance: 'trusted_mount_reference', datumSpecSha256: HANDLE_DATUM_SHA256, artifacts });
    return new SavedHandleReference(directory, reference);
  }
  descriptor() {
    return { referenceId: this.reference.referenceId, revisionId: this.reference.revisionId,
      stepSha256: this.reference.artifacts.find(a => a.mediaType === 'model/step')!.sha256, datumSpecSha256: HANDLE_DATUM_SHA256 } as const;
  }
  dispatchArtifact(): DispatchReferenceArtifact {
    const step = this.reference.artifacts.find(a => a.mediaType === 'model/step')!;
    return { referenceId: this.reference.referenceId, revisionId: this.reference.revisionId, artifactId: step.artifactId,
      kind: 'reference', units: 'mm', path: path.join(this.directory, step.fileName), sha256: step.sha256,
      datumSpec: { path: path.join(this.directory, 'datums.json'), sha256: HANDLE_DATUM_SHA256 } };
  }
  async describe() {
    for (const a of this.reference.artifacts) await this.read(a.artifactId);
    return structuredClone(this.reference);
  }
  async read(artifactId: string) {
    const artifact = this.reference.artifacts.find(a => a.artifactId === artifactId);
    if (!artifact) throw new StoreError(404, 'INVALID_REQUEST', 'Unknown reference artifact.');
    try {
      const bytes = await readRegular(path.join(this.directory, artifact.fileName));
      if (bytes.length !== artifact.bytes || await sha256(bytes) !== artifact.sha256) throw new Error('Reference integrity failure');
      return { artifact: structuredClone(artifact), bytes };
    } catch { throw new StoreError(409, 'EVIDENCE_CONFLICT', 'Saved reference integrity failure.'); }
  }
}
