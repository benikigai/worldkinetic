/** Copy actual protected-run observations into a fresh, sanitized boundary package. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCheckBundleHash, sha256, ToolResultSchema } from '../shared/contracts-v2.js';

const privateRoot = process.argv[2];
if (!privateRoot || !path.isAbsolute(privateRoot)) throw new Error('Supply an absolute protected trial directory');
const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'examples/handle/trials/v2');
await fs.mkdir(destination);
const files: Record<string, { sha256: string; bytes: number }> = {};
async function save(relative: string, bytes: Uint8Array | string) {
  const target = path.join(destination, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes, { flag: 'wx' });
  files[path.relative(root, target)] = { sha256: await sha256(bytes), bytes: Buffer.byteLength(bytes) };
}
const verifierHashes: Record<string, string> = {};
for (const name of ['adapter.ts', 'cad_runner.py', 'handle_binding.py', 'handle_geometry.py', 'handle_mesh.py',
  'handle_pipeline.py', 'handle_reference.ts', 'handle_verify.py', 'requirements_binding.py', 'mesh_checks.py']) {
  verifierHashes[`src/tools/${name}`] = await sha256(await fs.readFile(path.join(root, 'src/tools', name)));
}
const referenceRoot = path.join(privateRoot, 'mount-reference');
for (const name of ['reference.step', 'preview.stl', 'datums.json']) {
  await save(`reference/${name}`, await fs.readFile(path.join(referenceRoot, name)));
}
const reference = JSON.parse(await fs.readFile(path.join(referenceRoot, 'provenance.json'), 'utf8'));
await save('reference/provenance.json', JSON.stringify({
  scope: 'Fresh trusted two-pad reference from protected developer acceptance; not product registration',
  engine: reference.engine, measurement: reference.measurement, startedAt: reference.startedAt,
  completedAt: reference.completedAt, verifierSha256: reference.verifierSha256,
  allStageContainersRemoved: reference.stages.every((stage: { removed: boolean }) => stage.removed),
}, null, 2));
for (const name of ['valid_initial', 'rotated_seam_initial', 'outboard_below_minimum', 'outboard_at_minimum']) {
  const original = await fs.readFile(path.join(privateRoot, `${name}.json`));
  const result = ToolResultSchema.parse(JSON.parse(original.toString('utf8')));
  const core = JSON.parse(await fs.readFile(path.join(path.dirname(result.artifacts[0]!.path), 'result.json'), 'utf8'));
  if (result.referenceHash !== files['examples/handle/trials/v2/reference/reference.step']!.sha256) {
    throw new Error('Reference identity mismatch');
  }
  for (const [staged, hash] of Object.entries(core.verifierSha256)) {
    const source = staged === 'verify.py' ? 'handle_verify.py' : staged;
    if (verifierHashes[`src/tools/${source}`] !== hash) throw new Error('Verifier changed since observation');
  }
  for (const artifact of result.artifacts) {
    const bytes = await fs.readFile(artifact.path);
    if (await sha256(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) throw new Error('Artifact changed');
    await save(`${name}/${artifact.fileName}`, bytes);
    artifact.path = `/saved-developer-trials/handle/v2/${name}/${artifact.fileName}`;
  }
  if (await computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId }) !== result.checkBundleHash) {
    throw new Error('Sanitization changed check bundle');
  }
  const sanitized = JSON.stringify(result, null, 2);
  await save(`${name}/result.json`, sanitized);
  await save(`${name}/provenance.json`, JSON.stringify({
    scope: 'Actual isolated fixed developer source; synthetic registered initial STEP and acceptance descriptor; not product provider generation or user acceptance',
    originalPrivateResultSha256: await sha256(original), sanitizedResultSha256: await sha256(sanitized),
    checkBundleHash: result.checkBundleHash, startedAt: core.startedAt, completedAt: core.completedAt,
    verifierSha256: core.verifierSha256,
    allStageContainersRemoved: core.stages.every((stage: { removed: boolean }) => stage.removed),
    artifacts: result.artifacts.map(({ fileName, sha256, bytes }) => ({ fileName, sha256, bytes })),
  }, null, 2));
}
await fs.writeFile(path.join(destination, 'hash-manifest.json'), JSON.stringify({
  scope: 'Actual protected followup boundary observations; unchanged v1 historical artifacts', verifierHashes, files,
}, null, 2), { flag: 'wx' });
