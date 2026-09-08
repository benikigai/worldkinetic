import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { checkedPath, invoke, readRegular } from './adapter.js';
import { DispatchReferenceArtifactSchema, HANDLE_DATUM_CANONICAL_JSON, HANDLE_DATUM_SHA256, sha256 } from '../shared/contracts-v2.js';

/** Private creation descriptors. Registration and acceptance belong to BACKEND. */
export async function createHandleReference(input: { outputDir: string; remainingBudgetMs: number; signal: AbortSignal }) {
  const started = performance.now();
  const output = await checkedPath(input.outputDir);
  const staging = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'worldkinetics-handle-reference-'));
  try {
    const datumFile = path.join(staging, 'datums.json');
    await fs.writeFile(datumFile, Buffer.from(HANDLE_DATUM_CANONICAL_JSON, 'utf8'), { flag: 'wx', mode: 0o444 });
    const budget = Math.min(180000, input.remainingBudgetMs) - (performance.now() - started);
    const raw = await invoke(['--create-handle-reference', '--length-mm', '1', '--output-dir', output,
      '--datums-file', datumFile, '--deadline-seconds', String(budget / 1000)], input.signal, budget);
    const result = z.object({ stages: z.array(z.object({ removed: z.literal(true) })).length(3),
      artifacts: z.array(z.object({ name: z.string(), sha256: z.string(), bytes: z.number() })).length(3) }).parse(raw);
    for (const artifact of result.artifacts) {
      if (!['reference.step', 'preview.stl', 'datums.json'].includes(artifact.name)) throw new Error('Unexpected reference artifact');
      const bytes = await readRegular(path.join(output, artifact.name));
      if (await sha256(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) throw new Error('Reference bytes changed');
    }
    const step = await readRegular(path.join(output, 'reference.step'));
    const preview = await readRegular(path.join(output, 'preview.stl'));
    const datums = await readRegular(path.join(output, 'datums.json'));
    if (!datums.equals(Buffer.from(HANDLE_DATUM_CANONICAL_JSON, 'utf8'))) throw new Error('Datum bytes changed');
    if (input.signal.aborted || performance.now() - started >= Math.min(180000, input.remainingBudgetMs)) throw new Error('RUN_TIMEOUT');
    return {
      referenceArtifact: DispatchReferenceArtifactSchema.parse({ referenceId: 'handle_mount_v1', revisionId: 'handle_mount_reference_v1',
        artifactId: 'reference_handle_step', kind: 'reference', units: 'mm', path: path.join(output, 'reference.step'), sha256: await sha256(step),
        datumSpec: { path: path.join(output, 'datums.json'), sha256: HANDLE_DATUM_SHA256 } }),
      previewArtifact: { path: path.join(output, 'preview.stl'), sha256: await sha256(preview) },
    };
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
