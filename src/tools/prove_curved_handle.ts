/** Fixed developer feasibility inputs, never product provider/acceptance evidence. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cadToolAdapter } from './adapter.js';
import { CONTRACT_VERSION, HANDLE_DATUM_SHA256, createHandleRequirements, sha256,
  verifyToolInput, verifyToolResult, type AcceptedInitial, type ToolResult } from '../shared/contracts-v2.js';

const sources = process.argv.slice(2);
if (sources.length < 1 || sources.length > 2) throw new Error('Supply initial source and optional additive refinement source');
const parent = path.resolve('.runtime/tools/curved-proof');
await fs.mkdir(parent, { recursive: true });
const scratch = await fs.mkdtemp(path.join(parent, 'run-'));
const referencePath = path.resolve('examples/handle/reference/reference.step');
const referenceHash = await sha256(await fs.readFile(referencePath));
const reference = { referenceId: 'handle_mount_v1' as const, revisionId: 'handle_mount_reference_v1' as const,
  stepSha256: referenceHash, datumSpecSha256: HANDLE_DATUM_SHA256 } as const;
let initial: ToolResult | undefined;
let accepted: AcceptedInitial | undefined;
for (const [index, file] of sources.entries()) {
  const stage = index === 0 ? 'initial' : 'refined';
  const requirements = await createHandleRequirements(index === 0
    ? { designId: 'curved_developer_proof', requirementsVersion: 1, setupId: 'handle_initial_v1', reference }
    : { designId: 'curved_developer_proof', requirementsVersion: 2, setupId: 'handle_refine_v1', reference, acceptedInitial: accepted! });
  const step = initial?.artifacts.find(a => a.kind === 'export');
  const data = await verifyToolInput({ contractVersion: CONTRACT_VERSION, runId: `curved_${stage}`, requestId: `curved_request_${stage}`,
    designId: requirements.designId, inputRevisionId: initial?.outputRevisionId ?? 'handle_mount_reference_v1',
    outputRevisionId: `curved_candidate_${stage}`, attemptId: `curved_attempt_${stage}`, units: 'mm', requirements,
    registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
    proposal: { kind: 'python_source', source: await fs.readFile(file, 'utf8'), changeSummary: 'Fixed developer feasibility source; not product model generation' },
    referenceArtifact: { referenceId: 'handle_mount_v1', artifactId: 'developer_mount', revisionId: 'handle_mount_reference_v1', kind: 'reference', units: 'mm',
      path: referencePath, sha256: referenceHash, datumSpec: { path: path.resolve('examples/handle/reference/datums.json'), sha256: HANDLE_DATUM_SHA256 } },
    inputArtifacts: step ? [{ artifactId: accepted!.artifactId, revisionId: initial!.outputRevisionId, kind: 'export', units: 'mm', path: step.path, sha256: step.sha256 }] : [],
    outputDir: path.join(scratch, stage), remainingBudgetMs: 120000 });
  await fs.writeFile(path.join(scratch, `${stage}.input.json`), JSON.stringify(data, null, 2));
  const result = await cadToolAdapter({ ...data, signal: new AbortController().signal });
  await verifyToolResult(result, data);
  await fs.writeFile(path.join(scratch, `${stage}.result.json`), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ stage, scratch, status: result.status, error: result.error,
    checks: result.checks.map(c => ({ id: c.checkId, state: c.state, measured: c.measured })) }) + '\n');
  if (result.status !== 'completed' || result.checks.some(c => c.state !== 'passed')) process.exit(1);
  if (index === 0) {
    initial = result;
    const step = result.artifacts.find(a => a.kind === 'export')!;
    accepted = { acceptanceId: 'developer_synthetic_initial', artifactId: 'developer_initial_step', revisionId: result.outputRevisionId,
      sha256: step.sha256, requirementsId: result.requirementsId, requirementsVersion: result.requirementsVersion,
      setupHash: result.setupHash, sourceSha256: result.sourceSha256!, checkBundleHash: result.checkBundleHash! };
  }
}
