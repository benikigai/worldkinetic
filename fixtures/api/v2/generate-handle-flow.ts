import { writeFile } from 'node:fs/promises';
import * as c from '../../../src/shared/contracts-v2.js';
import { AcceptanceSchema, ManifestSchema, type Acceptance } from '../../../src/shared/state-v2.js';
import { verifyAcceptanceHistory } from '../../../src/shared/transport-v2.js';

// This writes only transport JSON. Synthetic strings never become CAD files or runtime inputs.
const designId = 'handle_fixture';
const executionMode = 'fixture' as const;
const units = 'mm' as const;
const contractVersion = c.CONTRACT_VERSION;
const reference = {
  referenceId: 'handle_mount_v1' as const,
  revisionId: 'handle_mount_reference_v1' as const,
  stepSha256: await c.sha256('SYNTHETIC handle-flow mount reference identity; no reference bytes exist'),
  datumSpecSha256: c.HANDLE_DATUM_SHA256,
};
const engine = {
  name: 'fixture' as const, version: 'synthetic_handle_flow_v1',
  imageDigest: `sha256:${await c.sha256('SYNTHETIC handle-flow engine identity; no image exists')}`,
};

function identity(requirements: c.HandleRequirements) {
  const { requirementsId, requirementsVersion, registryId, registryHash, setupId, setupHash,
    referenceHash, validatorVersion } = requirements;
  return { requirementsId, requirementsVersion, registryId, registryHash, setupId, setupHash,
    referenceHash, validatorVersion };
}

async function candidateFor(requirements: c.HandleRequirements, inputRevisionId: string) {
  const refined = requirements.setupId === 'handle_refine_v1';
  const stage = refined ? 'refined' : 'initial';
  const revisionId = `fixture_handle_${stage}`;
  const runId = `fixture_handle_${stage}_run`;
  const createdAt = refined ? '2026-09-08T19:02:00.000Z' : '2026-09-08T19:00:00.000Z';
  const changeSummary = `SYNTHETIC ${stage} handle transport data. No CAD execution or actual acceptance proof.`;
  const proposal = c.ProviderProposalSchema.parse({
    kind: 'python_source', source: `# SYNTHETIC ${stage} handle-flow source identity only; no CAD generation.\n`,
    changeSummary,
  });
  if (proposal.kind !== 'python_source') throw new Error('Expected synthetic source proposal.');
  const step = `SYNTHETIC ${stage} handle-flow STEP identity; invalid STEP format.\n`;
  const stl = `SYNTHETIC ${stage} handle-flow STL identity; invalid STL format.\n`;
  const geometryHash = await c.sha256(step);
  const sourceSha256 = await c.sha256(proposal.source);
  const stlHash = await c.sha256(stl);
  const stations = requirements.setup.geometry.grip.sectionStationsXmm.map(xMm => ({
    xMm, connectedFaceCount: 1, widthMm: refined ? (xMm === 0 ? 18 : 14) : 10,
    areaMm2: refined ? (xMm === 0 ? 90 : 70) : 50,
    minYmm: refined ? -7 : -5, maxYmm: refined ? (xMm === 0 ? 11 : 7) : 5,
  }));
  const measured: Record<string, c.JsonValue> = {
    'geometry.valid_single_solid': { solidCount: 1, valid: true, connected: true, nonempty: true,
      finiteBounds: true, positiveFiniteVolume: true, volumeMm3: refined ? 4600 : 3200 },
    'handle.mount_interface': { axisDisplacementMm: [0, 0], removedPadVolumesMm3: [0, 0],
      referenceSolidCount: 2, panelHolesAreHandleBores: false, referenceHash: reference.stepSha256 },
    'handle.envelope': { outsideVolumeMm3: 0, maximumEnvelopeExcessMm: 0, overallLengthMm: 110 },
    'handle.grip_clearance': { intersectingSolids: 0, minimumGapMm: 25, gapKernelInsetMm: 1e-7 },
    'handle.grip_sections': { clippedSolidCount: 1, xSpanMm: 60, stations },
    'handle.refinement_delta': {
      acceptedInitial: requirements.setup.acceptedInitial, removedInitialVolumeMm3: 0,
      stations: stations.map(station => ({ xMm: station.xMm, initialWidthMm: 10,
        refinedWidthMm: station.widthMm, widthIncreaseMm: station.widthMm - 10,
        initialAreaMm2: 50, refinedAreaMm2: station.areaMm2, addedSectionAreaMm2: station.areaMm2 - 50 })),
      thumbRestAddedVolumeMm3: 80, initialProtrusionMm: 0, refinedProtrusionMm: 4,
      protrusionIncreaseMm: 4, outboardBoundaryYmm: 8, outboardAddedVolumeMm3: 30,
    },
    'export.step_reopen': { sha256: geometryHash, validSingleSolid: true,
      relativeVolumeError: 0, symmetricDifferenceVolumeMm3: 0, maximumAbsoluteErrorMm: 0,
      handleChecksMatch: true },
    'export.stl_reopen': { sha256: stlHash, finiteVertices: true, watertight: true, connected: true,
      consistentlyOriented: true, positiveVolume: true, relativeVolumeError: 0,
      maximumAbsoluteErrorMm: 0, handleChecksMatch: true, manifestUnits: units },
    'export.editable_reopen': { sourceSha256, isolatedRegeneration: true, validSingleSolid: true,
      relativeVolumeError: 0, symmetricDifferenceVolumeMm3: 0, maximumAbsoluteErrorMm: 0,
      handleChecksMatch: true, referenceHash: reference.stepSha256,
      acceptedInitial: requirements.setup.acceptedInitial },
  };
  const checks = requirements.requiredChecks.map(checkId => c.CheckSchema.parse({
    checkId, revisionId, ...identity(requirements), geometryHash, executionMode, state: 'passed',
    label: `SYNTHETIC fixture: ${checkId}`, ...c.handleCheckDefinition(checkId),
    expected: c.expectedForHandleCheck(requirements, checkId),
    measured: { fixture: true, executionEvidence: 'NOT_RUN', values: measured[checkId] },
    details: 'SYNTHETIC invented conformance values. No source, geometry, reopen or independent measurement was executed.',
  }));
  const candidate: c.Candidate = {
    contractVersion, runId, requestId: `${runId}_request`, designId, attemptId: `${runId}_attempt`,
    revisionId, inputRevisionId, ...identity(requirements), units, requirements, executionMode,
    status: 'reviewable', createdAt, updatedAt: createdAt, changeSummary, engine, sourceSha256,
    proposalHash: await c.hashCanonical(proposal), geometryHash, checkBundleHash: null,
    checks, artifacts: [], error: null,
  };
  candidate.checkBundleHash = await c.computeCheckBundleHash(candidate);
  async function artifact(suffix: string, kind: c.Artifact['kind'], fileName: string, mediaType: string, text: string) {
    const artifactId = `${revisionId}_${suffix}`;
    return c.ArtifactSchema.parse({
      artifactId, runId, designId, revisionId, ...identity(requirements), units, kind, fileName,
      mediaType, bytes: Buffer.byteLength(text, 'utf8'), sha256: await c.sha256(text),
      href: `/api/artifacts/${artifactId}`, executionMode,
    });
  }
  candidate.artifacts = await Promise.all([
    artifact('source', 'source', 'model.py', 'text/x-python', proposal.source),
    artifact('editable', 'editable', 'editable.py', 'text/x-python', proposal.source),
    artifact('step', 'export', 'part.step', 'model/step', step),
    artifact('stl', 'preview', 'part.stl', 'model/stl', stl),
    artifact('requirements', 'specification', 'requirements.json', 'application/json', c.canonicalize(requirements)),
    artifact('checks', 'checks', 'checks.json', 'application/json', c.canonicalize(c.checkBundleHashPayload(candidate))),
  ]);
  return c.verifyCandidateEvidence(candidate);
}

async function accept(candidate: c.Candidate, expectedStateVersion: number, previous: string | null, acceptedAt: string) {
  const acceptance = AcceptanceSchema.parse({
    contractVersion, acceptanceId: `${candidate.revisionId}_acceptance`, acceptedAt,
    stateVersion: expectedStateVersion + 1, candidate, requirements: candidate.requirements,
    request: {
      contractVersion, requestId: `${candidate.revisionId}_accept_request`, designId,
      candidateRevisionId: candidate.revisionId, requirementsVersion: candidate.requirementsVersion,
      expectedStateVersion, expectedAcceptedRevisionId: previous, registryHash: candidate.registryHash,
      setupHash: candidate.setupHash, geometryHash: candidate.geometryHash,
      checkBundleHash: candidate.checkBundleHash, userActionId: `${candidate.revisionId}_fixture_user_action`,
    },
  });
  const payload = {
    contractVersion, manifestId: `${candidate.revisionId}_manifest`, acceptanceId: acceptance.acceptanceId,
    designId, runId: candidate.runId, revisionId: candidate.revisionId, requirements: candidate.requirements,
    checkBundleHash: candidate.checkBundleHash, geometryHash: candidate.geometryHash,
    sourceSha256: candidate.sourceSha256, proposalHash: candidate.proposalHash,
    engine: candidate.engine, checks: candidate.checks, changeSummary: candidate.changeSummary,
    units, artifacts: candidate.artifacts,
  };
  return { acceptance, manifest: ManifestSchema.parse({ ...payload, manifestHash: await c.hashCanonical(payload) }) };
}

function bootstrap(requirements: c.HandleRequirements, candidates: c.Candidate[], selected: c.Candidate,
  accepted: Acceptance, stateVersion: number) {
  return c.BootstrapSchema.parse({
    contractVersion, scopeStatus: 'selected', executionMode, requirements, candidates, unavailableReason: null,
    design: {
      designId, label: 'SYNTHETIC handle-flow transport fixture', units, stateVersion,
      referenceId: reference.referenceId, referenceHash: reference.stepSha256,
      setupId: requirements.setupId, setupHash: requirements.setupHash,
      baselineRevisionId: reference.revisionId, activeRequirementsVersion: requirements.requirementsVersion,
      acceptedRevisionId: accepted.candidate.revisionId,
      acceptedRequirementsMatch: accepted.requirements.requirementsId === requirements.requirementsId,
      selectedCandidateRevisionId: selected.revisionId, activeRunId: null,
    },
    runs: candidates.map(candidate => ({
      contractVersion, runId: candidate.runId, requestId: candidate.requestId, designId,
      inputRevisionId: candidate.inputRevisionId, ...identity(c.HandleRequirementsSchema.parse(candidate.requirements)),
      units, instruction: candidate.changeSummary, status: 'completed', executionMode,
      attemptIds: [candidate.attemptId], candidateRevisionIds: [candidate.revisionId], activeAttemptId: null,
      createdAt: candidate.createdAt, updatedAt: candidate.updatedAt, error: null,
    })),
  });
}

const initialRequirements = await c.createHandleRequirements({ designId, requirementsVersion: 1,
  setupId: 'handle_initial_v1', reference, validatorVersion: 'fixture_handle_validator_v1' });
const initial = await candidateFor(initialRequirements, reference.revisionId);
const first = await accept(initial, 7, null, '2026-09-08T19:01:00.000Z');
const initialStep = initial.artifacts.find(artifact => artifact.mediaType === 'model/step');
if (!initialStep) throw new Error('Synthetic initial STEP descriptor missing.');
const refinedRequirements = await c.createHandleRequirements({
  designId, requirementsVersion: 2, setupId: 'handle_refine_v1', reference,
  validatorVersion: 'fixture_handle_validator_v1',
  acceptedInitial: c.AcceptedInitialSchema.parse({
    acceptanceId: first.acceptance.acceptanceId, revisionId: initial.revisionId,
    artifactId: initialStep.artifactId, sha256: initialStep.sha256,
    requirementsId: initial.requirementsId, requirementsVersion: initial.requirementsVersion,
    setupHash: initial.setupHash, sourceSha256: initial.sourceSha256, checkBundleHash: initial.checkBundleHash,
  }),
});
const refined = await candidateFor(refinedRequirements, initial.revisionId);
const second = await accept(refined, 10, initial.revisionId, '2026-09-08T19:03:00.000Z');
const initialHistory = { contractVersion, acceptances: [first.acceptance], manifests: [first.manifest] };
const finalHistory = { contractVersion, acceptances: [first.acceptance, second.acceptance],
  manifests: [first.manifest, second.manifest] };
await verifyAcceptanceHistory(initialHistory);
await verifyAcceptanceHistory(finalHistory);

const fixture = {
  label: 'SYNTHETIC handle-flow transport fixture. Invented checks and acceptances; no CAD or user action executed.',
  executionEvidence: 'NOT_RUN',
  initialAccepted: {
    bootstrap: bootstrap(initialRequirements, [initial], initial, first.acceptance, 8),
    history: structuredClone(initialHistory),
  },
  refinementReviewable: {
    bootstrap: bootstrap(refinedRequirements, [initial, refined], refined, first.acceptance, 10),
    history: structuredClone(initialHistory),
  },
  finalAccepted: {
    bootstrap: bootstrap(refinedRequirements, [initial, refined], refined, second.acceptance, 11),
    history: structuredClone(finalHistory),
  },
};

await writeFile(new URL('./handle-flow.fixture.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
