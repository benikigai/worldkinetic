/** Publish sanitized developer artifacts without rewriting private observations. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCheckBundleHash, sha256, ToolResultSchema, type ToolResult } from '../shared/contracts-v2.js';

const privateRoot = process.argv[2];
if (!privateRoot || !path.isAbsolute(privateRoot)) throw new Error('Supply an absolute private trial directory');
const root = fileURLToPath(new URL('../../', import.meta.url));
const referenceDir = path.join(root, 'examples/handle/reference');
const trialsDir = path.join(root, 'examples/handle/trials/v1');
await fs.mkdir(referenceDir, { recursive: true });
await fs.mkdir(trialsDir, { recursive: true });
const manifest: Record<string, { sha256: string; bytes: number }> = {};
async function copy(source: string, target: string) {
  const bytes = await fs.readFile(source);
  await fs.writeFile(target, bytes, { flag: 'wx' });
  const descriptor = { sha256: await sha256(bytes), bytes: bytes.length };
  manifest[path.relative(root, target)] = descriptor;
  return descriptor;
}
async function writeRecorded(target: string, text: string) {
  await fs.writeFile(target, text, { flag: 'wx' });
  manifest[path.relative(root, target)] = { sha256: await sha256(text), bytes: Buffer.byteLength(text) };
}
for (const name of ['reference.step','preview.stl','datums.json']) await copy(path.join(privateRoot, 'reference', name), path.join(referenceDir, name));
const provenance = JSON.parse(await fs.readFile(path.join(privateRoot, 'reference/provenance.json'), 'utf8')) as { engine: unknown; measurement: unknown; startedAt: string; completedAt: string; verifierSha256: Record<string, string> };
const verifierFiles = ['adapter.ts','cad_runner.py','handle_binding.py','handle_geometry.py','handle_mesh.py','handle_pipeline.py','handle_reference.ts','handle_verify.py','requirements_binding.py','mesh_checks.py'];
const verifierHashes: Record<string, string> = {};
for (const name of verifierFiles) verifierHashes[`src/tools/${name}`] = await sha256(await fs.readFile(path.join(root, 'src/tools', name)));
await writeRecorded(path.join(referenceDir, 'provenance.json'), JSON.stringify({ scope: 'Trusted fixed two-pad construction and independent reopen; private creation, not registration or acceptance',
  engine: provenance.engine, measurement: provenance.measurement, startedAt: provenance.startedAt, completedAt: provenance.completedAt, verifierSha256: provenance.verifierSha256, files: { ...manifest } }, null, 2));
let refinement: ToolResult | undefined;
for (const name of await fs.readdir(privateRoot)) {
  if (!name.endsWith('.result.json')) continue;
  const bytes = await fs.readFile(path.join(privateRoot, name));
  const core = JSON.parse(await fs.readFile(path.join(privateRoot, name.replace('.result.json', ''), 'result.json'), 'utf8')) as { startedAt: string; completedAt: string; verifierSha256: Record<string, string> };
  const result = ToolResultSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (result.referenceHash !== manifest['examples/handle/reference/reference.step']!.sha256) throw new Error('Trial reference changed');
  const caseName = name.replace('.result.json', '');
  const directory = path.join(trialsDir, caseName);
  await fs.mkdir(directory);
  for (const artifact of result.artifacts) {
    const target = path.join(directory, artifact.fileName);
    const copied = await copy(artifact.path, target);
    if (copied.sha256 !== artifact.sha256 || copied.bytes !== artifact.bytes) throw new Error('Trial artifact bytes changed');
    artifact.path = `/saved-developer-trials/handle/v1/${caseName}/${artifact.fileName}`;
  }
  // Private paths are excluded from the check bundle; retain and verify its exact identity.
  if (await computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId }) !== result.checkBundleHash) throw new Error('Sanitization changed the check bundle');
  await writeRecorded(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  await writeRecorded(path.join(directory, 'provenance.json'), JSON.stringify({ scope: 'Fixed developer source; synthetic registration and acceptance descriptor; not product model generation or acceptance',
    originalPrivateResultSha256: await sha256(bytes), sanitizedResultSha256: await sha256(JSON.stringify(result, null, 2)),
    checkBundleHash: result.checkBundleHash, startedAt: core.startedAt, completedAt: core.completedAt, verifierSha256: core.verifierSha256, artifacts: result.artifacts.map(a => ({ fileName: a.fileName, sha256: a.sha256, bytes: a.bytes })) }, null, 2));
  if (caseName === 'valid_refinement') refinement = result;
}
if (!refinement) throw new Error('Missing refinement trial');
const fixture = structuredClone(refinement);
fixture.executionMode = 'fixture';
fixture.engine = { name: 'fixture', version: 'handle-shape-v1', imageDigest: `sha256:${'0'.repeat(64)}` };
fixture.checks.forEach(c => { c.executionMode = 'fixture'; c.details = 'Fixture conformance data copied from fixed developer measurements; not product execution evidence.'; });
fixture.artifacts.forEach(a => { a.executionMode = 'fixture'; a.path = `/fixture/handle/${a.fileName}`; });
fixture.checkBundleHash = await computeCheckBundleHash({ ...fixture, revisionId: fixture.outputRevisionId });
ToolResultSchema.parse(fixture);
await fs.writeFile(path.join(root, 'fixtures/tools/handle-v2-result.fixture.json'), JSON.stringify(fixture, null, 2));
await fs.writeFile(path.join(trialsDir, 'hash-manifest.json'), JSON.stringify({ scope: 'Actual fixed developer trial artifacts', verifierHashes, files: manifest }, null, 2), { flag: 'wx' });
