import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ArtifactSchema, IdSchema, type Artifact, type Candidate, type ToolResult } from '../shared/contracts.js';
import { requirementIdentity } from './store.js';

export class ArtifactStore {
  constructor(readonly root: string) {}
  private async checkedFile(root: string, file: string) {
    const base = path.resolve(root);
    if ((await lstat(base)).isSymbolicLink()) throw new Error('Symbolic artifact root');
    const resolvedRoot = await realpath(base);
    const target = path.resolve(base, file);
    if (!target.startsWith(base + path.sep)) throw new Error('Artifact escapes root');
    let current = base;
    for (const component of path.relative(base, target).split(path.sep)) {
      current = path.join(current, component);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic artifact path');
    }
    const actual = await realpath(target);
    if (!actual.startsWith(resolvedRoot + path.sep)) throw new Error('Artifact escapes root');
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > 25 * 1024 * 1024) throw new Error('Invalid artifact size');
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  async import(candidate: Candidate, outputDir: string, files: ToolResult['artifacts'], signal?: AbortSignal): Promise<Artifact[]> {
    signal?.throwIfAborted();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const result: Artifact[] = [];
    try {
      for (const file of structuredClone(files)) {
        signal?.throwIfAborted();
        const bytes = await this.checkedFile(outputDir, file.path);
        if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Artifact declaration mismatch');
        const artifactId = `artifact_${randomUUID()}`;
        const artifact = ArtifactSchema.parse({ ...requirementIdentity(candidate.requirements), artifactId,
          runId: candidate.runId, designId: candidate.designId, revisionId: candidate.revisionId, units: candidate.units,
          kind: file.kind, fileName: file.fileName, mediaType: file.mediaType, bytes: bytes.length, sha256: file.sha256,
          href: `/api/artifacts/${artifactId}`, executionMode: file.executionMode });
        result.push(artifact);
        await writeFile(path.join(this.root, artifactId), bytes, { mode: 0o400, flag: 'wx' });
        signal?.throwIfAborted();
      }
      return result;
    } catch (error) { await this.discard(result); throw error; }
  }
  async read(input: Artifact): Promise<Buffer> {
    const artifact = ArtifactSchema.parse(structuredClone(input));
    const content = await this.checkedFile(this.root, artifact.artifactId);
    if (content.length !== artifact.bytes || createHash('sha256').update(content).digest('hex') !== artifact.sha256) throw new Error('Stored artifact integrity failure');
    return content;
  }
  async discard(artifacts: Artifact[]) {
    await Promise.all(artifacts.map(async artifact => {
      const id = IdSchema.parse(artifact.artifactId);
      try { await unlink(path.join(this.root, id)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }));
  }
}
