import { spawn } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  checkDefinition, computeCheckBundleHash, expectedForCheck, hashCanonical, sha256,
  verifyToolInput, verifyToolResult, safeError, JsonValueSchema, HANDLE_DATUM_CANONICAL_JSON, HANDLE_DATUM_SHA256,
  type ApiError, type Check, type ToolAdapter, type ToolResult,
} from '../shared/contracts-v2.js';

const MAX_BYTES = 25 * 1024 * 1024;
const IMAGE = 'sha256:bba502dc5c3fb943c078cdcb5c0a4b9faa321839ceb59bcfd5c41c33cbe0c440';
const runner = fileURLToPath(new URL('./cad_runner.py', import.meta.url));
const coreSchema = z.object({
  executionMode: z.literal('live'), lengthMm: z.number().finite().nullable(),
  sourceSha256: z.string(), geometryHash: z.string(), referenceSha256: z.string(),
  engine: z.object({ name: z.literal('build123d'), version: z.literal('0.11.1'), imageId: z.literal(IMAGE) }),
  stages: z.array(z.object({ role: z.string(), removed: z.literal(true) })).length(4),
  checks: z.array(z.object({
    checkId: z.string(), state: z.enum(['passed', 'failed', 'not_evaluated']),
    method: z.string(), measured: JsonValueSchema, measuredValue: JsonValueSchema.optional(),
  })).min(7).max(9),
  artifacts: z.array(z.object({ name: z.string(), sha256: z.string(), bytes: z.number().int().positive() })).length(4),
});
const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const pointPairs = z.array(z.tuple([point, point])).max(16);

class AdapterError extends Error {
  constructor(readonly code: ApiError['code']) { super(code); }
}

export async function checkedPath(value: string): Promise<string> {
  if (!path.isAbsolute(value) || /[,\x00-\x1f]/.test(value)) throw new AdapterError('INVALID_REQUEST');
  const resolved = path.resolve(value);
  let current = resolved;
  while (true) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new AdapterError('INVALID_REQUEST');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    current = parent;
  }
}

export async function readRegular(file: string): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > MAX_BYTES) {
      throw new AdapterError('EXPORT_FAILED');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new AdapterError('EVIDENCE_CONFLICT');
    }
    return bytes;
  } finally { await handle.close(); }
}

const errorCodes: Record<string, ApiError['code']> = {
  INVALID_PARAMETERS: 'INVALID_REQUEST', INPUT_NOT_FOUND: 'EVIDENCE_CONFLICT',
  INPUT_REVISION_MISMATCH: 'EVIDENCE_CONFLICT', EVIDENCE_CONFLICT: 'EVIDENCE_CONFLICT',
  TOOL_TIMEOUT: 'RUN_TIMEOUT', TOOL_UNAVAILABLE: 'TOOL_UNAVAILABLE',
  EXECUTION_FAILED: 'EXECUTION_FAILED', CHECK_FAILED: 'CHECK_FAILED', EXPORT_FAILED: 'EXPORT_FAILED',
};

// Wait for Python's close event, including its named-container cleanup. Killing
// or abandoning the host child at the computation deadline would orphan CAD.
export async function invoke(args: string[], signal: AbortSignal, budgetMs: number): Promise<unknown> {
  if (signal.aborted || budgetMs <= 0) throw new AdapterError('RUN_TIMEOUT');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', runner, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let cancelled = false;
    let oversized = false;
    const cancel = () => {
      if (!cancelled) { cancelled = true; child.kill('SIGTERM'); }
    };
    const timer = setTimeout(cancel, Math.min(budgetMs, 2_147_483_647));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const release = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    child.stdout.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_BYTES) { oversized = true; cancel(); }
      else stdout += chunk.toString('utf8');
    });
    child.on('error', () => { release(); reject(new AdapterError('TOOL_UNAVAILABLE')); });
    child.on('close', (code) => {
      release();
      let value: unknown;
      try { value = JSON.parse(stdout); } catch {
        reject(new AdapterError(cancelled ? 'RUN_TIMEOUT' : 'EXECUTION_FAILED')); return;
      }
      const failure = z.object({ error: z.object({ code: z.string() }) }).safeParse(value);
      // An unconfirmed cleanup must never be mistaken for a usable completion.
      if (failure.success && failure.data.error.code === 'TOOL_UNAVAILABLE') {
        reject(new AdapterError('TOOL_UNAVAILABLE')); return;
      }
      if (oversized || cancelled) {
        reject(new AdapterError(oversized ? 'EXPORT_FAILED' : 'RUN_TIMEOUT')); return;
      }
      if (failure.success || code !== 0) {
        reject(new AdapterError(failure.success ? errorCodes[failure.data.error.code] ?? 'EXECUTION_FAILED' : 'EXECUTION_FAILED'));
        return;
      }
      resolve(value);
    });
  });
}

export const cadToolAdapter: ToolAdapter = async input => {
  const started = performance.now();
  const { signal, ...serializable } = input;
  const data = await verifyToolInput(serializable);
  const remaining = () => Math.min(
    Math.min(180000, data.remainingBudgetMs ?? 180000) - (performance.now() - started),
    data.deadline === undefined ? Infinity : Date.parse(data.deadline) - Date.now(),
  );
  const r = data.requirements;
  const identity = {
    requirementsId: r.requirementsId, requirementsVersion: r.requirementsVersion,
    registryId: r.registryId, registryHash: r.registryHash, setupId: r.setupId, setupHash: r.setupHash,
    referenceHash: r.referenceHash, validatorVersion: r.validatorVersion,
  };
  const base: ToolResult = {
    contractVersion: data.contractVersion, runId: data.runId, requestId: data.requestId, designId: data.designId,
    inputRevisionId: data.inputRevisionId, outputRevisionId: data.outputRevisionId, attemptId: data.attemptId,
    units: data.units, ...identity, requirements: r, proposal: data.proposal,
    proposalHash: await hashCanonical(data.proposal), executionMode: 'live', status: 'failed',
    sourceSha256: null, engine: null, geometryHash: null, checkBundleHash: null, checks: [], artifacts: [],
    error: safeError('EXECUTION_FAILED'),
  };
  const fail = (code: ApiError['code']) => verifyToolResult({
    ...base, executionMode: code === 'TOOL_UNAVAILABLE' ? 'unavailable' : 'live',
    status: code === 'TOOL_UNAVAILABLE' ? 'unavailable' : 'failed', error: safeError(code),
  }, data);
  let staging: string | undefined;
  try {
    if (signal.aborted || remaining() <= 0) throw new AdapterError('RUN_TIMEOUT');
    const isHandle = r.registryId === 'handle_sample_v1';
    if (r.validatorVersion !== (isHandle ? 'handle-validator-v1' : 'plate-validator-v1')) {
      throw new AdapterError('TOOL_UNAVAILABLE');
    }
    const references = data.inputArtifacts.filter(a => a.kind === 'reference' && a.sha256 === r.referenceHash);
    const reference = data.referenceArtifact ?? references[0];
    if (!reference) throw new AdapterError('EVIDENCE_CONFLICT');
    let referenceBytes: Buffer;
    try {
      await checkedPath(reference.path);
      referenceBytes = await readRegular(reference.path);
      if (await sha256(referenceBytes) !== r.referenceHash) throw new AdapterError('EVIDENCE_CONFLICT');
    } catch { throw new AdapterError('EVIDENCE_CONFLICT'); }
    let datumBytes: Buffer | undefined;
    let baselineBytes: Buffer | undefined;
    try {
      // Recheck every private input before creating immutable snapshots.
      for (const artifact of data.inputArtifacts) {
        await checkedPath(artifact.path);
        const bytes = await readRegular(artifact.path);
        if (await sha256(bytes) !== artifact.sha256) throw new AdapterError('EVIDENCE_CONFLICT');
        if (r.registryId === 'handle_sample_v1' && r.setup.acceptedInitial?.artifactId === artifact.artifactId) baselineBytes = bytes;
      }
      if (isHandle) {
        const datum = data.referenceArtifact?.datumSpec;
        if (!datum) throw new AdapterError('EVIDENCE_CONFLICT');
        await checkedPath(datum.path);
        datumBytes = await readRegular(datum.path);
        if (!datumBytes.equals(Buffer.from(HANDLE_DATUM_CANONICAL_JSON, 'utf8'))
          || await sha256(datumBytes) !== HANDLE_DATUM_SHA256) throw new AdapterError('EVIDENCE_CONFLICT');
      }
    } catch { throw new AdapterError('EVIDENCE_CONFLICT'); }
    let output: string;
    try {
      output = await checkedPath(data.outputDir);
      if (!(await fs.stat(path.dirname(output))).isDirectory()
        || reference.path === output || reference.path.startsWith(output + path.sep)) throw new AdapterError('INVALID_REQUEST');
      try { await fs.lstat(output); throw new AdapterError('INVALID_REQUEST'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } catch { throw new AdapterError('INVALID_REQUEST'); }
    staging = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'worldkinetics-binding-'));
    const referenceFile = path.join(staging, 'reference.step');
    const requirementsFile = path.join(staging, 'requirements.json');
    await fs.writeFile(referenceFile, referenceBytes, { flag: 'wx', mode: 0o444 });
    await fs.writeFile(requirementsFile, JSON.stringify({
      requirements: r, registryCanonicalJson: data.registryCanonicalJson, setupCanonicalJson: data.setupCanonicalJson,
    }), { flag: 'wx', mode: 0o444 });
    const sourceArgs: string[] = [];
    if (data.proposal.kind === 'python_source') {
      const sourceFile = path.join(staging, 'source.py');
      await fs.writeFile(sourceFile, Buffer.from(data.proposal.source, 'utf8'), { flag: 'wx', mode: 0o444 });
      sourceArgs.push('--source-file', sourceFile);
    }
    if (datumBytes) {
      const file = path.join(staging, 'datums.json');
      await fs.writeFile(file, datumBytes, { flag: 'wx', mode: 0o444 });
      sourceArgs.push('--datums-file', file, '--handle');
    }
    if (baselineBytes) {
      const file = path.join(staging, 'baseline.step');
      await fs.writeFile(file, baselineBytes, { flag: 'wx', mode: 0o444 });
      sourceArgs.push('--baseline-step', file);
    }
    const length = r.registryId === 'handle_sample_v1' ? null : r.setup.dimensions.lengthMm;
    const budget = remaining();
    const raw = await invoke([
      '--length-mm', String(length ?? 1), '--output-dir', output, ...sourceArgs,
      '--reference-step', referenceFile, '--reference-sha256', r.referenceHash,
      '--requirements-json', requirementsFile, '--deadline-seconds', String(budget / 1000),
    ], signal, budget);
    const parsedCore = coreSchema.safeParse(raw);
    if (!parsedCore.success) throw new AdapterError('CHECK_FAILED');
    const core = parsedCore.data;
    if (core.lengthMm !== length || core.referenceSha256 !== r.referenceHash
      || core.stages.map(s => s.role).join(',') !== 'generator,regenerator,verifier,export_verifier') {
      throw new AdapterError('EVIDENCE_CONFLICT');
    }
    const specifications = [
      ['source.py', 'source', 'text/x-python'], ['editable.py', 'editable', 'text/x-python'],
      ['candidate.step', 'export', 'model/step'], ['preview.stl', 'preview', 'model/stl'],
    ] as const;
    await checkedPath(output);
    const entries = await fs.readdir(output);
    if (entries.sort().join(',') !== [...specifications.map(s => s[0]), 'result.json'].sort().join(',')) throw new AdapterError('EXPORT_FAILED');
    const artifacts: ToolResult['artifacts'] = [];
    let total = (await readRegular(path.join(output, 'result.json'))).length;
    for (const [fileName, kind, mediaType] of specifications) {
      const file = path.join(output, fileName);
      const bytes = await readRegular(file);
      const digest = await sha256(bytes);
      const claims = core.artifacts.filter(a => a.name === fileName);
      if (claims.length !== 1 || claims[0].sha256 !== digest || claims[0].bytes !== bytes.length) throw new AdapterError('EVIDENCE_CONFLICT');
      total += bytes.length;
      artifacts.push({ path: file, fileName, kind, mediaType, sha256: digest, bytes: bytes.length, executionMode: 'live' });
    }
    if (total > MAX_BYTES) throw new AdapterError('EXPORT_FAILED');
    if (artifacts[0].sha256 !== core.sourceSha256 || artifacts[1].sha256 !== core.sourceSha256
      || artifacts[2].sha256 !== core.geometryHash) throw new AdapterError('EVIDENCE_CONFLICT');
    if (new Set(core.checks.map(c => c.checkId)).size !== r.requiredChecks.length
      || core.checks.some(c => !r.requiredChecks.includes(c.checkId))) throw new AdapterError('CHECK_FAILED');
    const checks: Check[] = core.checks.map(c => {
      const check: Check = {
        ...identity, checkId: c.checkId, revisionId: data.outputRevisionId, geometryHash: core.geometryHash,
        executionMode: 'live', state: c.state, label: c.checkId, ...checkDefinition(c.checkId, r.registryId),
        expected: expectedForCheck(r, c.checkId),
        measured: { measurement: c.measured, coreMethod: c.method, ...(c.measuredValue === undefined ? {} : { measuredValue: c.measuredValue }) },
        details: 'Measured by the isolated CAD verifier against sealed geometry and frozen requirements.',
      };
      if (c.checkId === 'margin.end_material') {
        const measured = z.object({ closestPointPairs: pointPairs }).parse(c.measured);
        check.diagnostics = { pointPairs: measured.closestPointPairs };
      }
      if (c.checkId === 'feature.requested_change' || c.checkId === 'interface.protected_region') {
        const measured = z.object({ closestPointPairs: pointPairs, diagnosticBounds: z.tuple([point, point]).nullable() }).parse(c.measured);
        check.diagnostics = { pointPairs: measured.closestPointPairs,
          ...(measured.diagnosticBounds ? { box: measured.diagnosticBounds } : {}) };
      }
      if (isHandle && c.measured && typeof c.measured === 'object' && !Array.isArray(c.measured)) {
        const diagnostic = z.object({ diagnosticBounds: z.tuple([point, point]).nullable().optional(), closestPointPairs: pointPairs.optional() }).parse(c.measured);
        if (diagnostic.diagnosticBounds || diagnostic.closestPointPairs?.length) check.diagnostics = {
          ...(diagnostic.diagnosticBounds ? { box: diagnostic.diagnosticBounds } : {}),
          ...(diagnostic.closestPointPairs?.length ? { pointPairs: diagnostic.closestPointPairs } : {}),
        };
      }
      return check;
    });
    const result: ToolResult = {
      ...base, status: 'completed', error: null, sourceSha256: core.sourceSha256, geometryHash: core.geometryHash,
      engine: { name: core.engine.name, version: core.engine.version, imageDigest: core.engine.imageId }, checks, artifacts,
    };
    result.checkBundleHash = await computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId });
    const verified = await verifyToolResult(result, data).catch(() => { throw new AdapterError('EVIDENCE_CONFLICT'); });
    await fs.rm(staging, { recursive: true, force: true });
    staging = undefined;
    if (signal.aborted || remaining() <= 0) throw new AdapterError('RUN_TIMEOUT');
    return verified;
  } catch (error) {
    return fail(error instanceof AdapterError ? error.code : 'EXECUTION_FAILED');
  } finally {
    if (staging) {
      try { await fs.rm(staging, { recursive: true, force: true }); }
      catch { return fail('EXECUTION_FAILED'); }
    }
  }
};
