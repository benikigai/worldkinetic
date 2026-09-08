import { z } from 'zod';
import {
  AcceptanceRequestSchema, CONTRACT_VERSION, DesignSchema, ErrorSchema, EventSchema,
  RequirementsSchema, RunSchema, canonicalize, hashCanonical,
  verifyCandidateEvidence, verifyRequirements,
} from './contracts-v2.js';
import {
  AcceptanceHistorySchema, AcceptanceSchema, ManifestSchema,
  type Acceptance, type AcceptanceHistory, type Manifest,
} from './state-v2.js';

export const ApiErrorResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), error: ErrorSchema,
}).strict();
export const EventsResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), events: z.array(EventSchema),
}).strict();
export const RunMutationResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), reused: z.boolean(), run: RunSchema,
}).strict();
export const RequirementsMutationResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), reused: z.boolean(),
  design: DesignSchema, requirements: RequirementsSchema,
}).strict();
export const AcceptanceMutationResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), reused: z.boolean(),
  acceptance: AcceptanceSchema, manifest: ManifestSchema,
}).strict();

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type RunMutationResponse = z.infer<typeof RunMutationResponseSchema>;
export type RequirementsMutationResponse = z.infer<typeof RequirementsMutationResponseSchema>;
export type AcceptanceMutationResponse = z.infer<typeof AcceptanceMutationResponseSchema>;

async function verifyAcceptancePair(acceptance: Acceptance, manifest: Manifest): Promise<void> {
  const candidate = await verifyCandidateEvidence(acceptance.candidate);
  const requirements = await verifyRequirements(acceptance.requirements);
  // The source and editable deliverables can describe the same immutable bytes.
  const byteCounts = new Map<string, number>();
  for (const artifact of candidate.artifacts) {
    const knownBytes = byteCounts.get(artifact.sha256);
    if (knownBytes !== undefined && knownBytes !== artifact.bytes) {
      throw new Error('Artifacts with the same hash must have the same byte count.');
    }
    byteCounts.set(artifact.sha256, artifact.bytes);
  }
  const request = acceptance.request;
  if (candidate.status !== 'reviewable'
    || acceptance.stateVersion !== request.expectedStateVersion + 1
    || request.designId !== candidate.designId
    || request.candidateRevisionId !== candidate.revisionId
    || request.requirementsVersion !== candidate.requirementsVersion
    || request.registryHash !== candidate.registryHash
    || request.setupHash !== candidate.setupHash
    || request.geometryHash !== candidate.geometryHash
    || request.checkBundleHash !== candidate.checkBundleHash
    || canonicalize(requirements) !== canonicalize(candidate.requirements)) {
    throw new Error('Acceptance request and candidate evidence mismatch.');
  }

  const { manifestHash, ...payload } = manifest;
  if (await hashCanonical(payload) !== manifestHash) throw new Error('Manifest hash mismatch.');
  const expected = {
    contractVersion: CONTRACT_VERSION, manifestId: manifest.manifestId,
    acceptanceId: acceptance.acceptanceId, designId: candidate.designId,
    runId: candidate.runId, revisionId: candidate.revisionId, requirements,
    checkBundleHash: candidate.checkBundleHash, geometryHash: candidate.geometryHash,
    sourceSha256: candidate.sourceSha256, proposalHash: candidate.proposalHash,
    engine: candidate.engine, checks: candidate.checks, changeSummary: candidate.changeSummary,
    units: candidate.units, artifacts: candidate.artifacts,
  };
  if (canonicalize(payload) !== canonicalize(expected)) throw new Error('Manifest and acceptance evidence mismatch.');
}

/** Checks a historical evidence binding, not freshness, live eligibility or user authentication. */
export async function verifyAcceptanceResponse(value: unknown, expectedRequest?: unknown): Promise<AcceptanceMutationResponse> {
  const response = AcceptanceMutationResponseSchema.parse(value);
  if (expectedRequest !== undefined
    && canonicalize(response.acceptance.request) !== canonicalize(AcceptanceRequestSchema.parse(expectedRequest))) {
    throw new Error('Acceptance does not match the expected request.');
  }
  await verifyAcceptancePair(response.acceptance, response.manifest);
  return response;
}

/** Preserve both input arrays; revision IDs are deliberately not unique across acceptances. */
export async function verifyAcceptanceHistory(value: unknown): Promise<AcceptanceHistory> {
  const history = AcceptanceHistorySchema.parse(value);
  const acceptanceIds = new Set(history.acceptances.map(record => record.acceptanceId));
  const manifestIds = new Set(history.manifests.map(record => record.manifestId));
  const requestIds = new Set(history.acceptances.map(record => record.request.requestId));
  const versions = new Set(history.acceptances.map(record => record.stateVersion));
  const manifests = new Map(history.manifests.map(record => [record.acceptanceId, record]));
  if (acceptanceIds.size !== history.acceptances.length
    || requestIds.size !== history.acceptances.length || versions.size !== history.acceptances.length
    || manifestIds.size !== history.manifests.length || manifests.size !== history.manifests.length
    || history.manifests.length !== history.acceptances.length
    || history.manifests.some(record => !acceptanceIds.has(record.acceptanceId))) {
    throw new Error('History requires unique identities and exactly one manifest per acceptance.');
  }
  // Compare commit order on a copy, without discarding repeated revisions or changing output order.
  const chronological = [...history.acceptances].sort((a, b) => a.stateVersion - b.stateVersion);
  for (const [index, acceptance] of chronological.entries()) {
    if (acceptance.candidate.designId !== chronological[0]!.candidate.designId
      || acceptance.request.expectedAcceptedRevisionId !== (chronological[index - 1]?.candidate.revisionId ?? null)) {
      throw new Error('Acceptance history design or previous acceptance mismatch.');
    }
    const manifest = manifests.get(acceptance.acceptanceId);
    if (!manifest) throw new Error('Acceptance manifest is missing.');
    await verifyAcceptancePair(acceptance, manifest);
  }
  return history;
}
