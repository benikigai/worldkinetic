/** Developer refinement proof against actual provider geometry, synthetic acceptance only. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cadToolAdapter } from './adapter.js';
import { CONTRACT_VERSION, HANDLE_DATUM_SHA256, createHandleRequirements, sha256,
  verifyToolInput, verifyToolResult } from '../shared/contracts-v2.js';

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('Supply the saved actual-baseline blend package directory');
const original = path.resolve(packageRoot);
const report = JSON.parse(await fs.readFile(path.join(original, 'initial-binding.json'), 'utf8'));
const baseline = path.join(original, 'baseline.step');
if (await sha256(await fs.readFile(baseline)) !== report.geometryHash) throw new Error('Actual baseline hash mismatch');
const referencePath = path.resolve('examples/handle/reference/reference.step');
const referenceHash = await sha256(await fs.readFile(referencePath));
const accepted = { acceptanceId: 'developer_synthetic_actual_initial', artifactId: 'developer_actual_initial_step', revisionId: report.revisionId,
  sha256: report.geometryHash, requirementsId: report.requirementsId, requirementsVersion: 1,
  setupHash: report.setupHash, sourceSha256: report.sourceSha256, checkBundleHash: report.checkBundleHash };
const requirements = await createHandleRequirements({ designId: 'handle', requirementsVersion: 2, setupId: 'handle_refine_v1',
  reference: { referenceId: 'handle_mount_v1', revisionId: 'handle_mount_reference_v1', stepSha256: referenceHash, datumSpecSha256: HANDLE_DATUM_SHA256 }, acceptedInitial: accepted });
const parent = path.resolve('.runtime/tools/curved-proof');
await fs.mkdir(parent, { recursive: true });
const scratch = await fs.mkdtemp(path.join(parent, 'actual-blend-'));
const input = await verifyToolInput({ contractVersion: CONTRACT_VERSION, runId: 'developer_actual_blend', requestId: 'developer_actual_blend_request',
  designId: 'handle', inputRevisionId: report.revisionId, outputRevisionId: 'developer_blended_candidate', attemptId: 'developer_actual_blend_attempt', units: 'mm', requirements,
  registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
  proposal: { kind: 'python_source', source: await fs.readFile(path.join(original, 'source.py'), 'utf8'), changeSummary: 'Developer additive smooth thumb-root feasibility against actual provider initial; synthetic acceptance only' },
  referenceArtifact: { referenceId: 'handle_mount_v1', artifactId: 'developer_mount', revisionId: 'handle_mount_reference_v1', kind: 'reference', units: 'mm',
    path: referencePath, sha256: referenceHash, datumSpec: { path: path.resolve('examples/handle/reference/datums.json'), sha256: HANDLE_DATUM_SHA256 } },
  inputArtifacts: [{ artifactId: accepted.artifactId, revisionId: report.revisionId, kind: 'export', units: 'mm', path: baseline, sha256: report.geometryHash }],
  outputDir: path.join(scratch, 'refined'), remainingBudgetMs: 120000 });
await fs.writeFile(path.join(scratch, 'refined.input.json'), JSON.stringify(input, null, 2));
const result = await cadToolAdapter({ ...input, signal: new AbortController().signal });
await verifyToolResult(result, input);
await fs.writeFile(path.join(scratch, 'refined.result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ scratch, status: result.status, error: result.error, checks: result.checks.map(c => ({ id: c.checkId, state: c.state, measured: c.measured })), artifacts: result.artifacts }));
if (result.status !== 'completed' || result.checks.some(c => c.state !== 'passed')) process.exit(1);
