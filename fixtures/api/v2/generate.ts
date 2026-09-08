/** Synthetic conformance data only. This script does not call CAD, providers, or HTTP. */
import { readFile, writeFile } from 'node:fs/promises';
import {
  CONTRACT_VERSION, BootstrapSchema, RunRequestSchema, AcceptanceRequestSchema, RequirementsUpdateRequestSchema,
  ExportRequestSchema, EventSchema, ProviderProposalSchema, ToolInputSchema, ToolResultSchema, createRequirements,
  expectedForCheck, checkDefinition, computeCheckBundleHash, checkBundleHashPayload, canonicalize, parseStrictJson,
  sha256, hashCanonical, verifyRequirements, verifyCandidateEvidence, verifyToolInput, verifyToolResult,
  REGISTRY_FILE_SHA256, REGISTRY_HASH, REGISTRY_CANONICAL_JSON, type Check, type Artifact, type Candidate, type JsonValue,
} from '../../../src/shared/contracts-v2.js';

const write = async (name: string, value: unknown) => writeFile(new URL(name, import.meta.url), `${JSON.stringify(value, null, 2)}\n`);
const syntheticBytes: Record<string, string> = {};
const now = '2026-09-08T19:00:00.000Z';
for (const length of [36, 30]) {
  const label = length === 36 ? 'reviewable' : 'rejected';
  const prefix = `fixture_${length}`;
  const requirements = await createRequirements({ designId: 'fixture_plate', requirementsVersion: length === 36 ? 2 : 1, setupId: 'resize_centered_v1', lengthMm: length, validatorVersion: 'fixture_validator_v1' });
  const identity = {
    requirementsId: requirements.requirementsId, requirementsVersion: requirements.requirementsVersion,
    registryId: requirements.registryId, registryHash: requirements.registryHash,
    setupId: requirements.setupId, setupHash: requirements.setupHash, referenceHash: requirements.referenceHash,
    validatorVersion: requirements.validatorVersion,
  };
  const source = `# SYNTHETIC fixture ${length}: no CAD execution or accepted geometry.\n`;
  const proposal = ProviderProposalSchema.parse({ kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm: length } } });
  const sourceSha256 = await sha256(source);
  const proposalHash = await hashCanonical(proposal);
  const geometryBytes = `SYNTHETIC fixture STEP descriptor ${length}. Not a CAD file.\n`;
  const geometryHash = await sha256(geometryBytes);
  const artifacts: Artifact[] = [];
  const descriptions = [
    { suffix: 'source', fileName: `${prefix}_model.py`, kind: 'source', mediaType: 'text/x-python', content: source },
    { suffix: 'editable', fileName: `${prefix}_editable.py`, kind: 'editable', mediaType: 'text/x-python', content: source },
    { suffix: 'step', fileName: `${prefix}_part.step`, kind: 'export', mediaType: 'model/step', content: geometryBytes },
    { suffix: 'stl', fileName: `${prefix}_part.stl`, kind: 'preview', mediaType: 'model/stl', content: `SYNTHETIC fixture STL descriptor ${length}. Not a mesh.\n` },
  ] as const;
  for (const description of descriptions) {
    const artifactId = `${prefix}_${description.suffix}`;
    syntheticBytes[artifactId] = description.content;
    artifacts.push({
      artifactId, runId: `${prefix}_run`, designId: requirements.designId, revisionId: `${prefix}_revision`, ...identity,
      units: 'mm', kind: description.kind, fileName: description.fileName, mediaType: description.mediaType,
      bytes: new TextEncoder().encode(description.content).length, sha256: await sha256(description.content),
      href: `/api/artifacts/${artifactId}`, executionMode: 'fixture',
    });
  }
  const boundsMm = [[0, length], [0, 35], [0, 5]];
  const volumeMm3 = length * 35 * 5 - 2 * Math.PI * 3 ** 2 * 5;
  const margin = (length - 26) / 2;
  const centersMm = [[(length - 20) / 2, 17.5], [(length + 20) / 2, 17.5]];
  const measured: Record<string, JsonValue> = {
    'geometry.valid_single_solid': { fixture: true, solidCount: 1, valid: true, connected: true, nonempty: true, boundsMm, volumeMm3 },
    'geometry.requested_dimensions': { fixture: true, lengthMm: length, widthMm: 35, baseThicknessMm: 5, boundsMm, maximumAbsoluteErrorMm: 0 },
    'holes.layout': { fixture: true, count: 2, diametersMm: [6, 6], axes: [[0, 0, 1], [0, 0, 1]], centersMm, spacingMm: 20, throughDepthMm: [5, 5], unobstructedFullExtent: true, maximumAbsoluteErrorMm: 0 },
    'margin.end_material': { fixture: true, endMaterialsMm: [margin, margin], minimumEndMaterialMm: margin },
    'export.step_reopen': { fixture: true, sha256: geometryHash, validSingleSolid: true, boundsMm, volumeMm3, relativeVolumeError: 0, symmetricDifferenceVolumeMm3: 0, maximumAbsoluteErrorMm: 0, dimensionsAndHolesMatch: true },
    'export.stl_reopen': { fixture: true, sha256: artifacts[3]!.sha256, finiteVertices: true, watertight: true, connected: true, consistentlyOriented: true, enclosedVolumeMm3: volumeMm3, relativeVolumeError: 0, boundsMm, maximumAbsoluteErrorMm: 0, dimensionsAndHolesMatch: true, unobstructedFullExtent: true, manifestUnits: 'mm' },
    'export.editable_reopen': { fixture: true, sourceSha256, isolatedRegeneration: true, validSingleSolid: true, boundsMm, volumeMm3, relativeVolumeError: 0, symmetricDifferenceVolumeMm3: 0, maximumAbsoluteErrorMm: 0, dimensionsAndHolesMatch: true, nativeHistory: 'fixture source only; no native document' },
  };
  const checks: Check[] = requirements.requiredChecks.map(checkId => ({
    checkId, revisionId: `${prefix}_revision`, ...identity, geometryHash, executionMode: 'fixture',
    state: checkId === 'margin.end_material' && length === 30 ? 'failed' : 'passed',
    label: `Synthetic fixture: ${checkId}`, ...checkDefinition(checkId),
    expected: expectedForCheck(requirements, checkId), measured: measured[checkId]!,
    details: checkId === 'margin.end_material'
      ? `SYNTHETIC fixture expectation ${margin} mm versus immutable minimum 5 mm. No geometric distance measurement was executed.`
      : 'SYNTHETIC conformance values. No geometry, reopen, or independent measurement was executed.',
    ...(checkId === 'margin.end_material' ? { diagnostics: {
      pointPairs: [[[0, 17.5, 2.5], [margin, 17.5, 2.5]], [[length - margin, 17.5, 2.5], [length, 17.5, 2.5]]],
      message: 'Synthetic closest-point pairs for the centered plate fixture.',
    } as Check['diagnostics'] } : {}),
  }));
  const candidate: Candidate = {
    contractVersion: CONTRACT_VERSION, runId: `${prefix}_run`, requestId: `${prefix}_request`, designId: requirements.designId,
    attemptId: `${prefix}_attempt_1`, revisionId: `${prefix}_revision`, inputRevisionId: 'fixture_baseline_50', ...identity,
    units: 'mm', requirements, executionMode: 'fixture', status: label, createdAt: now, updatedAt: now,
    changeSummary: `Synthetic ${length} mm centered resize. Fixture only; no accepted state.`,
    engine: { name: 'fixture', version: 'fixture_engine_v1', imageDigest: `sha256:${await sha256('SYNTHETIC fixture image; no runtime image')}` },
    sourceSha256, proposalHash, geometryHash, checkBundleHash: null, checks, artifacts, error: null,
  };
  candidate.checkBundleHash = await computeCheckBundleHash(candidate);
  const run = {
    contractVersion: CONTRACT_VERSION, runId: candidate.runId, requestId: candidate.requestId, designId: requirements.designId,
    inputRevisionId: candidate.inputRevisionId, ...identity, units: 'mm', instruction: `Synthetic request: make length ${length} mm.`,
    status: 'completed', executionMode: 'fixture', attemptIds: [candidate.attemptId], candidateRevisionIds: [candidate.revisionId],
    activeAttemptId: null, createdAt: now, updatedAt: now, error: null,
  };
  const bootstrap = BootstrapSchema.parse({
    contractVersion: CONTRACT_VERSION, scopeStatus: 'selected', executionMode: 'fixture',
    design: { designId: requirements.designId, label: 'SYNTHETIC plate conformance fixture', units: 'mm', stateVersion: length === 36 ? 11 : 7,
      referenceId: requirements.referenceId, referenceHash: requirements.referenceHash, setupId: requirements.setupId, setupHash: requirements.setupHash,
      baselineRevisionId: candidate.inputRevisionId, activeRequirementsVersion: requirements.requirementsVersion,
      acceptedRevisionId: null, acceptedRequirementsMatch: false, selectedCandidateRevisionId: candidate.revisionId, activeRunId: null },
    requirements, runs: [run], candidates: [candidate], unavailableReason: null,
  });
  await verifyRequirements(requirements);
  await verifyCandidateEvidence(candidate);
  await write(`${label}.fixture.json`, bootstrap);
  await write(`${label}.check-bundle.fixture.json`, { executionMode: 'fixture', payload: checkBundleHashPayload(candidate), canonicalJson: canonicalize(checkBundleHashPayload(candidate)), sha256: candidate.checkBundleHash });
  if (length === 36) {
    const runRequest = RunRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: candidate.requestId, designId: requirements.designId, inputRevisionId: candidate.inputRevisionId, requirementsVersion: 2, setupId: requirements.setupId, units: 'mm', instruction: 'Make length 36 mm' });
    await write('run-request.fixture.json', runRequest);
    await write('acceptance-request.fixture.json', AcceptanceRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: 'fixture_accept_request', designId: requirements.designId, candidateRevisionId: candidate.revisionId, requirementsVersion: 2, expectedStateVersion: 11, expectedAcceptedRevisionId: null, registryHash: requirements.registryHash, setupHash: requirements.setupHash, geometryHash, checkBundleHash: candidate.checkBundleHash, userActionId: 'fixture_explicit_accept_action' }));
    await write('requirements-update-request.fixture.json', RequirementsUpdateRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: 'fixture_confirm_36', expectedStateVersion: 7, expectedRequirementsVersion: 1, setupId: requirements.setupId, confirmedIntent: { lengthMm: 36 }, userActionId: 'fixture_confirm_action' }));
    await write('export-request.fixture.json', ExportRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId: 'fixture_export_request', acceptanceId: 'fixture_hypothetical_acceptance', manifestId: 'fixture_hypothetical_manifest', manifestHash: await sha256('SYNTHETIC hypothetical manifest; no acceptance or export exists') }));
    await write('event.fixture.json', EventSchema.parse({ contractVersion: CONTRACT_VERSION, eventId: 4, designId: requirements.designId, stateVersion: 11, runId: candidate.runId, revisionId: candidate.revisionId, requirementsVersion: 2, units: 'mm', executionMode: 'fixture', createdAt: now, type: 'candidate.reviewable', run, candidate, acceptanceId: null }));
    await write('provider-proposal.fixture.json', proposal);
    await write('provider-python-proposal.fixture.json', ProviderProposalSchema.parse({ kind: 'python_source', source: '# SYNTHETIC payload example only.\nfrom build123d import Box\npart = Box(50, 35, 5)\n', changeSummary: 'Synthetic Python transport example. Does not satisfy the plate checks.' }));
    const toolInput = ToolInputSchema.parse({
      contractVersion: CONTRACT_VERSION, runId: candidate.runId, requestId: candidate.requestId, designId: requirements.designId,
      inputRevisionId: candidate.inputRevisionId, outputRevisionId: candidate.revisionId, attemptId: candidate.attemptId, units: 'mm',
      requirements, registryCanonicalJson: requirements.registryCanonicalJson, setupCanonicalJson: requirements.setupCanonicalJson,
      proposal, outputDir: '/fixture-private/output', remainingBudgetMs: 180000,
      inputArtifacts: [{ artifactId: 'fixture_reference_step', revisionId: candidate.inputRevisionId, kind: 'reference', units: 'mm', path: '/fixture-private/reference.step', sha256: requirements.referenceHash }],
    });
    await verifyToolInput(toolInput);
    await write('tool-input.fixture.json', toolInput);
    const toolResult = ToolResultSchema.parse({
      contractVersion: CONTRACT_VERSION, runId: candidate.runId, requestId: candidate.requestId, designId: requirements.designId,
      inputRevisionId: candidate.inputRevisionId, outputRevisionId: candidate.revisionId, attemptId: candidate.attemptId, units: 'mm',
      ...identity, requirements, executionMode: 'fixture', status: 'completed', proposal, proposalHash, sourceSha256,
      engine: candidate.engine, geometryHash, checkBundleHash: candidate.checkBundleHash, checks,
      artifacts: artifacts.map(artifact => ({ path: `/fixture-private/output/${artifact.fileName}`, kind: artifact.kind, fileName: artifact.fileName, mediaType: artifact.mediaType, bytes: artifact.bytes, sha256: artifact.sha256, executionMode: artifact.executionMode })), error: null,
    });
    await verifyToolResult(toolResult, toolInput);
    await write('tool-result.fixture.json', toolResult);
  }
}

await write('synthetic-artifact-bytes.fixture.json', { executionMode: 'fixture', description: 'Synthetic UTF-8 content used only to reproduce descriptor hashes. These are not CAD files or available downloads.', artifacts: syntheticBytes });
const rawRegistry = await readFile(new URL('../requirement-registry.json', import.meta.url));
if (await sha256(rawRegistry) !== REGISTRY_FILE_SHA256) throw new Error('Frozen registry file changed.');
await write('registry-hashes.fixture.json', { registryFileSha256: REGISTRY_FILE_SHA256, registryHash: REGISTRY_HASH, registryCanonicalJson: REGISTRY_CANONICAL_JSON });
await write('feature-requirements.fixture.json', await createRequirements({ designId: 'fixture_feature_plate', requirementsVersion: 1, setupId: 'tactile_feature_v1', validatorVersion: 'fixture_validator_v1' }));
const canonicalCases = [
  { name: 'numeric_keys_unicode_numbers', inputJson: '{"z":-0,"2":2,"10":10,"a":"é\\n","tiny":1e-7,"large":1e21}' },
  { name: 'check_set_order', inputJson: '{"checks":[{"checkId":"z","value":1},{"checkId":"a","value":2}],"requiredChecks":["z","a"]}' },
  { name: 'coordinate_order', inputJson: '{"points":[[35,17.5],[15,17.5]]}' },
  { name: 'unicode_utf16_keys', inputJson: '{"\\ue000":1,"😀":2,"é":"é","slash":"/"}' },
  { name: 'escaped_equivalent_string_and_surrogate', inputJson: '{"a":"\\u0061","lone":"\\ud800","control":"\\u0000"}' },
  { name: 'ieee754_boundaries', inputJson: '[5e-324,1.7976931348623157e308,0.000001,0.0000001,100000000000000000000,1e21,-0,9007199254740993]' },
];
await write('canonical-hashes.fixture.json', {
  encoding: 'UTF-8; ECMAScript JSON primitives; UTF-16 lexicographic object keys; sorted named check sets; no trailing newline',
  valid: await Promise.all(canonicalCases.map(async item => {
    const canonicalJson = canonicalize(parseStrictJson(item.inputJson));
    return { ...item, canonicalJson, utf8Hex: Array.from(new TextEncoder().encode(canonicalJson), byte => byte.toString(16).padStart(2, '0')).join(''), sha256: await sha256(canonicalJson) };
  })),
  invalidJson: ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"z":1,"z":2}}', '{"x":1e400}', '{"x":NaN}', '[1,]', '{"a":1,}', 'true false', '{"a":01}', '"\\x61"'],
  invalidCanonicalJson: ['{"checks":[{"checkId":"a"},{"checkId":"a"}]}', '{"requiredChecks":["a","a"]}'],
  invalidJavascriptValues: ['undefined', 'NaN', 'Infinity', '-Infinity', 'function', 'symbol', 'bigint', 'sparse array', 'cyclic object', 'object accessor', 'Date', 'object with undefined property'],
});
