/** Developer fixtures only. Synthetic registration/acceptance is not product acceptance. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cadToolAdapter } from './adapter.js';
import { createHandleReference } from './handle_reference.js';
import { CONTRACT_VERSION, HANDLE_DATUM_SHA256, createHandleRequirements, verifyToolInput, verifyToolResult,
  type AcceptedInitial, type ToolResult, type ToolInputData } from '../shared/contracts-v2.js';

const cases = JSON.parse(await fs.readFile('tests/tools/handle_cases.json', 'utf8')) as {
  initialSource: string; roundedInitialSource: string; refinementSource: string; saveSource: string;
  initialCases: Case[]; refinementCases: Case[];
};
type Case = { id: string; sourceBase?: 'initialSource' | 'roundedInitialSource' | 'refinementSource'; source?: string; append?: string; expectedFailedChecks: string[] };
const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'worldkinetics-handle-trials-'));
const reference = await createHandleReference({ outputDir: path.join(scratch, 'reference'), remainingBudgetMs: 60000, signal: new AbortController().signal });
let accepted: AcceptedInitial | undefined;
let initial: ToolResult | undefined;
let refinementInput: ToolInputData | undefined;
const selected = process.argv.slice(2);
const allCases = [cases.initialCases[0]!, cases.refinementCases[0]!, ...cases.initialCases.slice(1), ...cases.refinementCases.slice(1)];
for (const c of allCases) {
  if (selected.length && !selected.includes(c.id)) continue;
  const refined = cases.refinementCases.includes(c);
  const source = (c.source ?? cases[c.sourceBase!]) + (c.append ?? '') + cases.saveSource;
  const guards = `from pathlib import Path
import hashlib
assert set(p.name for p in Path('/input').iterdir()) == ${refined ? "{'source.py','reference.step','datums.json','baseline.step'}" : "{'source.py','reference.step','datums.json'}"}
assert hashlib.sha256(Path('/input/datums.json').read_bytes()).hexdigest() == '${HANDLE_DATUM_SHA256}'
for name in ${refined ? "('reference.step','datums.json','baseline.step')" : "('reference.step','datums.json')"}:
    try:
        Path('/input/'+name).write_bytes(b'changed')
        raise AssertionError('input writable')
    except OSError: pass
`;
  const exactSource = guards + source.replaceAll('__MOUNT_REFERENCE__', '/input/reference.step').replaceAll('__ACCEPTED_BASELINE__', '/input/baseline.step');
  const ref = { referenceId: 'handle_mount_v1' as const, revisionId: 'handle_mount_reference_v1' as const,
    stepSha256: reference.referenceArtifact.sha256, datumSpecSha256: HANDLE_DATUM_SHA256 } as const;
  const requirements = await createHandleRequirements(refined
    ? { designId: 'handle_developer_trial', requirementsVersion: 2, setupId: 'handle_refine_v1', reference: ref, acceptedInitial: accepted! }
    : { designId: 'handle_developer_trial', requirementsVersion: 1, setupId: 'handle_initial_v1', reference: ref });
  const step = initial?.artifacts.find(a => a.kind === 'export');
  const data = await verifyToolInput({ contractVersion: CONTRACT_VERSION, runId: `run_${c.id}`, requestId: `request_${c.id}`,
    designId: requirements.designId, inputRevisionId: refined ? initial!.outputRevisionId : 'handle_mount_reference_v1',
    outputRevisionId: `candidate_${c.id}`, attemptId: `attempt_${c.id}`, units: 'mm', requirements,
    registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
    proposal: { kind: 'python_source', source: exactSource, changeSummary: 'Fixed developer trial, not model generation' },
    referenceArtifact: reference.referenceArtifact,
    inputArtifacts: refined ? [{ artifactId: 'developer_registered_initial_step', revisionId: initial!.outputRevisionId,
      kind: 'export', units: 'mm', path: step!.path, sha256: step!.sha256 }] : [],
    outputDir: path.join(scratch, c.id), remainingBudgetMs: 120000 });
  if (c.id === 'valid_refinement') refinementInput = data;
  const started = Date.now();
  const result = await cadToolAdapter({ ...data, signal: new AbortController().signal });
  await verifyToolResult(result, data);
  await fs.writeFile(path.join(scratch, `${c.id}.result.json`), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ case: c.id, seconds: (Date.now()-started)/1000, status: result.status,
    error: result.error, failed: result.checks.filter(c => c.state !== 'passed').map(c => c.checkId), scratch })+'\n');
  assert.equal(result.status, 'completed');
  for (const id of c.expectedFailedChecks) assert.equal(result.checks.find(c => c.checkId === id)?.state, 'failed');
  if (!c.expectedFailedChecks.length) assert.ok(result.checks.every(c => c.state === 'passed'), JSON.stringify(result.checks.filter(c => c.state !== 'passed')));
  if (c.id === 'valid_initial') {
    initial = result;
    const step = result.artifacts.find(a => a.kind === 'export')!;
    accepted = { acceptanceId: 'developer_synthetic_acceptance', artifactId: 'developer_registered_initial_step',
      revisionId: result.outputRevisionId, sha256: step.sha256, requirementsId: result.requirementsId,
      requirementsVersion: result.requirementsVersion, setupHash: result.setupHash,
      sourceSha256: result.sourceSha256!, checkBundleHash: result.checkBundleHash! };
  }
}

if (!selected.length && refinementInput) {
  const base = refinementInput;
  const exec = promisify(execFile);
  const names = async () => (await exec('docker', ['ps','-a','--filter','name=wk-cad-','--format','{{.Names}}'])).stdout.trim();
  const beforeNames = await names();
  const datum = path.join(scratch, 'wrong-datums.json');
  await fs.writeFile(datum, (await fs.readFile(reference.referenceArtifact.datumSpec!.path, 'utf8'))+'\n');
  for (const kind of ['datum', 'baseline']) {
    const data = structuredClone(base);
    data.outputDir = path.join(scratch, `invalid-${kind}`);
    if (kind === 'datum') data.referenceArtifact!.datumSpec!.path = datum;
    else data.inputArtifacts[0]!.path = reference.referenceArtifact.path;
    const result = await cadToolAdapter({ ...data, signal: new AbortController().signal });
    assert.equal(result.error?.code, 'EVIDENCE_CONFLICT');
    assert.equal(result.artifacts.length, 0); assert.equal(result.checks.length, 0);
    process.stdout.write(JSON.stringify({ case: `invalid_${kind}`, error: result.error?.code })+'\n');
  }
  const source = "import subprocess,sys,time\nsubprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True)\ntime.sleep(120)\n";
  for (const mode of ['timeout', 'abort']) {
    const abort = new AbortController();
    const timer = mode === 'abort' ? setTimeout(() => abort.abort(), 1800) : undefined;
    try {
      const result = await cadToolAdapter({ ...base, proposal: { kind: 'python_source', source, changeSummary: 'Developer cancellation control' },
        outputDir: path.join(scratch, mode), remainingBudgetMs: mode === 'timeout' ? 1800 : 120000, signal: abort.signal });
      assert.equal(result.error?.code, 'RUN_TIMEOUT');
      assert.equal(result.artifacts.length, 0); assert.equal(result.checks.length, 0);
      assert.equal(await names(), beforeNames);
      process.stdout.write(JSON.stringify({ case: mode, error: result.error?.code, knownContainersRemoved: true })+'\n');
    } finally { if (timer) clearTimeout(timer); }
  }
}
