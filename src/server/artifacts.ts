import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, Run, ToolResult } from '../shared/contracts.js';

export class ArtifactStore {
  constructor(readonly root: string) {}

  async import(run: Run, outputDir: string, files: ToolResult['artifacts'], signal?: AbortSignal): Promise<Artifact[]> {
    signal?.throwIfAborted();
    const outputRoot = await realpath(outputDir);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const result: Artifact[] = [];
    const written: string[] = [];
    try {
    for (const file of files) {
      signal?.throwIfAborted();
      const source = path.resolve(outputDir, file.path);
      const sourceReal = await realpath(source);
      if (!sourceReal.startsWith(outputRoot + path.sep) || (await lstat(source)).isSymbolicLink()) {
        throw new Error('Tool artifact escapes its run output directory');
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(file.fileName)) {
        throw new Error('Tool artifact filename is invalid');
      }
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[ a-zA-Z0-9=._-]+)?$/.test(file.mediaType)) {
        throw new Error('Tool artifact media type is invalid');
      }
      const info = await lstat(sourceReal);
      if (!info.isFile() || info.size < 1 || info.size > 50 * 1024 * 1024) {
        throw new Error('Tool artifact must be a nonempty regular file of at most 50 MiB');
      }
      const artifactId = `artifact_${randomUUID()}`;
      const destination = path.join(this.root, artifactId);
      written.push(destination);
      await copyFile(sourceReal, destination);
      signal?.throwIfAborted();
      const bytes = await readFile(destination);
      signal?.throwIfAborted();
      result.push({
        artifactId, runId: run.runId, designId: run.designId, revisionId: run.outputRevisionId,
        units: run.units, kind: file.kind, fileName: file.fileName, mediaType: file.mediaType,
        bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        href: `/api/artifacts/${artifactId}`, executionMode: 'live',
      });
    }
    return result;
    } catch (error) {
      await Promise.all(written.map(file => unlink(file).catch(() => {})));
      throw error;
    }
  }

  async read(artifact: Artifact): Promise<Buffer> {
    const handle = await open(path.join(this.root, artifact.artifactId), 'r');
    try {
      const content = await handle.readFile();
      if (content.length !== artifact.bytes || createHash('sha256').update(content).digest('hex') !== artifact.sha256) {
        throw new Error('Stored artifact integrity check failed');
      }
      return content;
    } finally { await handle.close(); }
  }

  async discard(artifacts: Artifact[]): Promise<void> {
    await Promise.all(artifacts.map(artifact => unlink(path.join(this.root, artifact.artifactId)).catch(() => {})));
  }
}
