/** Preserve actual curved developer observations; never manufacture provider provenance. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeCheckBundleHash, sha256, ToolResultSchema } from '../shared/contracts-v2.js';

const originalRoot = process.argv[2];
if (!originalRoot || !path.isAbsolute(originalRoot)) throw new Error('Supply an absolute curved proof directory');
const destination = path.resolve('examples/handle/trials/curved-v1');
await fs.mkdir(destination);
const files: Record<string, { sha256: string; bytes: number }> = {};
async function save(relative: string, data: string | Uint8Array) {
  const target = path.join(destination, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data, { flag: 'wx' });
  files[relative] = { sha256: await sha256(data), bytes: Buffer.byteLength(data) };
}
for (const stage of ['initial', 'refined']) {
  const original = await fs.readFile(path.join(originalRoot, `${stage}.result.json`));
  const result = ToolResultSchema.parse(JSON.parse(original.toString()));
  if (result.status !== 'completed' || result.checks.some(c => c.state !== 'passed')) throw new Error('Expected completed checked observation');
  const core = JSON.parse(await fs.readFile(path.join(originalRoot, stage, 'result.json'), 'utf8'));
  for (const [name, hash] of Object.entries(core.verifierSha256)) {
    const source = name === 'verify.py' ? 'handle_verify.py' : name;
    if (await sha256(await fs.readFile(path.resolve('src/tools', source))) !== hash) throw new Error(`Verifier changed: ${name}`);
  }
  for (const artifact of result.artifacts) {
    const bytes = await fs.readFile(artifact.path);
    if (bytes.length !== artifact.bytes || await sha256(bytes) !== artifact.sha256) throw new Error('Artifact changed');
    await save(`${stage}/${artifact.fileName}`, bytes);
    artifact.path = `/saved-developer-trials/handle/curved-v1/${stage}/${artifact.fileName}`;
  }
  if (await computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId }) !== result.checkBundleHash) throw new Error('Check bundle changed');
  await save(`${stage}/result.json`, JSON.stringify(result, null, 2));
  await save(`${stage}/provenance.json`, JSON.stringify({
    scope: 'OUTSIDE_WRAPPER: actual fixed developer source, synthetic initial registration and acceptance; not provider generation or user acceptance',
    originalPrivateResultSha256: await sha256(original), checkBundleHash: result.checkBundleHash,
    startedAt: core.startedAt, completedAt: core.completedAt, verifierSha256: core.verifierSha256,
    allStageContainersRemoved: core.stages.every((s: { removed: boolean }) => s.removed),
  }, null, 2));
}
await save('README.md', `# Curved handle developer proof\n\nActual isolated build123d geometry, independent regeneration and eight initial / nine refinement checks passed. This is fixed developer input with synthetic acceptance, not a product model run or user acceptance. STEP, STL and editable source retain their original bytes and hashes. Structured results preserve measurements and the check-bundle hash, with artifact paths relocated to logical fixture references. Provenance records the original private result hash.\n\nReproduce from the TOOLS worktree:\n\n\`\`\`sh\nnode --import tsx src/tools/prove_curved_handle.ts examples/handle/trials/curved-v1/initial/source.py examples/handle/trials/curved-v1/refined/source.py\n\`\`\`\n\nInitial: 110 mm overall length, 96 mm pad pitch, curved 8 mm thick bridge, 10 mm grip width, 1.5 mm edge fillets. Refinement: 14 mm wide bridge plus rounded 24 by 10 by 4 mm thumb shelf. Independent checks measured no removed material. Appearance review remains separate from geometry checks; no physical comfort, fit or strength claim.\n`);
await fs.writeFile(path.join(destination, 'hash-manifest.json'), JSON.stringify({ scope: 'Actual OUTSIDE_WRAPPER curved developer proof', files }, null, 2), { flag: 'wx' });
