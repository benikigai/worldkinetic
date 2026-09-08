import { z } from 'zod';
import { canonicalize, hashCanonical, parseStrictJson, sha256, type JsonValue } from './canonical-json.js';
import {
  CONTRACT_VERSION, IdSchema, HashSchema, VersionSchema, StateVersionSchema, UnitsSchema,
  ExecutionModeSchema, SetupIdSchema, CheckIdSchema, CheckUnitsSchema, LengthMmSchema, JsonValueSchema,
  RequirementsSchema, verifyRequirements, checkDefinition, expectedForCheck, type Requirements,
} from './requirements-v2.js';
export * from './canonical-json.js';
export * from './requirements-v2.js';
export * from './requirements-handle-v2.js';

export const MAX_PUBLIC_REQUEST_BYTES = 8192;
export const MAX_PYTHON_SOURCE_BYTES = 65536;
/** Apply to public mutation bodies before schema parsing, without a lossy JSON.parse step. */
export function parsePublicRequest<T>(raw: string, schema: z.ZodType<T>): T {
  if (new TextEncoder().encode(raw).length > MAX_PUBLIC_REQUEST_BYTES) throw new Error('Public request body exceeds 8 KiB.');
  return schema.parse(parseStrictJson(raw));
}
const timestamp = z.string().datetime({ offset: true });
const shortText = z.string().trim().min(1).max(2000);
const fileName = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const mediaType = z.string().min(1).max(100).regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/);
const bytes = z.number().int().nonnegative().max(25 * 1024 * 1024);
const artifactKind = z.enum(['source', 'editable', 'preview', 'export', 'specification', 'checks', 'manifest', 'reference']);
const privatePath = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f]/.test(value), 'Invalid private path.');
function sameJson(a: unknown, b: unknown): boolean {
  try { return canonicalize(a) === canonicalize(b); } catch { return false; }
}
function issue(context: z.RefinementCtx, message: string) {
  context.addIssue({ code: 'custom', message });
}
const errorMessages = {
  INVALID_REQUEST: 'The request is invalid.',
  IDENTITY_CONFLICT: 'The request identity conflicts with existing data.',
  EVIDENCE_CONFLICT: 'The evidence does not match the current requirements.',
  STATE_CONFLICT: 'The design state changed. Refresh before retrying.',
  PROVIDER_UNAVAILABLE: 'The generation provider is unavailable.',
  TOOL_UNAVAILABLE: 'The engineering runtime is unavailable.',
  RUN_TIMEOUT: 'The run exceeded its deadline.',
  EXECUTION_FAILED: 'The engineering operation failed.',
  CHECK_FAILED: 'The required checks could not be completed.',
  EXPORT_FAILED: 'The checked export is unavailable.',
  ACCESS_REQUIRED: 'Enter the demo access code to continue.',
  ACCESS_DENIED: 'Demo access was denied.',
  DEMO_BUSY: 'Another design is running. Try again after it finishes.',
  DEMO_LIMIT: 'The demo limit has been reached.',
} as const;
export const ErrorCodeSchema = z.enum(Object.keys(errorMessages) as [keyof typeof errorMessages, ...(keyof typeof errorMessages)[]]);
export const ErrorSchema = z.object({ code: ErrorCodeSchema, message: z.string().max(200), retryable: z.boolean() }).strict()
  .superRefine((error, context) => {
    if (error.message !== errorMessages[error.code]) issue(context, 'Use a fixed public error message.');
  });
export type ApiError = z.infer<typeof ErrorSchema>;
export function safeError(code: z.infer<typeof ErrorCodeSchema>): ApiError {
  const parsed = ErrorCodeSchema.parse(code);
  return { code: parsed, message: errorMessages[parsed], retryable: ['PROVIDER_UNAVAILABLE', 'TOOL_UNAVAILABLE', 'RUN_TIMEOUT'].includes(parsed) };
}

export const OperationSchema = z.object({
  name: z.literal('resize_plate'), parameters: z.object({ lengthMm: LengthMmSchema }).strict(),
}).strict();
export const ProviderProposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('numeric_operation'), operation: OperationSchema }).strict(),
  z.object({
    kind: z.literal('python_source'),
    source: z.string().min(1).max(MAX_PYTHON_SOURCE_BYTES).refine(value => value.trim().length > 0 && new TextEncoder().encode(value).length <= MAX_PYTHON_SOURCE_BYTES, 'Python source exceeds its UTF-8 limit or is empty.'),
    changeSummary: shortText,
  }).strict(),
]);
export type ProviderProposal = z.infer<typeof ProviderProposalSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export const RunRequestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requestId: IdSchema, designId: IdSchema,
  inputRevisionId: IdSchema, requirementsVersion: VersionSchema, setupId: SetupIdSchema,
  units: UnitsSchema, instruction: shortText,
}).strict();
export const AcceptanceRequestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requestId: IdSchema, designId: IdSchema,
  candidateRevisionId: IdSchema, requirementsVersion: VersionSchema, expectedStateVersion: StateVersionSchema,
  expectedAcceptedRevisionId: IdSchema.nullable(), registryHash: HashSchema, setupHash: HashSchema,
  geometryHash: HashSchema, checkBundleHash: HashSchema, userActionId: IdSchema,
}).strict();
const updateFields = {
  contractVersion: z.literal(CONTRACT_VERSION), requestId: IdSchema,
  expectedStateVersion: StateVersionSchema, expectedRequirementsVersion: VersionSchema, userActionId: IdSchema,
};
export const RequirementsUpdateRequestSchema = z.discriminatedUnion('setupId', [
  z.object({ ...updateFields, setupId: z.literal('resize_centered_v1'), confirmedIntent: z.object({ lengthMm: LengthMmSchema }).strict() }).strict(),
  z.object({ ...updateFields, setupId: z.literal('tactile_feature_v1'), confirmedIntent: z.object({}).strict() }).strict(),
  z.object({ ...updateFields, setupId: z.literal('handle_initial_v1'), confirmedIntent: z.object({}).strict() }).strict(),
  z.object({ ...updateFields, setupId: z.literal('handle_refine_v1'), confirmedIntent: z.object({}).strict() }).strict(),
]);
export const ExportRequestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requestId: IdSchema, acceptanceId: IdSchema, manifestId: IdSchema, manifestHash: HashSchema,
}).strict();

const requirementIdentity = {
  requirementsVersion: VersionSchema, requirementsId: IdSchema,
  registryId: z.enum(['plate_requirements_v1', 'handle_sample_v1']), registryHash: HashSchema,
  setupId: SetupIdSchema, setupHash: HashSchema, referenceHash: HashSchema, validatorVersion: IdSchema,
};
export const ArtifactSchema = z.object({
  artifactId: IdSchema, runId: IdSchema, designId: IdSchema, revisionId: IdSchema,
  ...requirementIdentity, units: UnitsSchema, kind: artifactKind, fileName, mediaType, bytes, sha256: HashSchema,
  href: z.string().regex(/^\/api\/artifacts\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/), executionMode: ExecutionModeSchema,
}).strict().superRefine((artifact, context) => {
  if (artifact.href !== `/api/artifacts/${artifact.artifactId}`) issue(context, 'Artifact URL must reference its registered immutable ID.');
  if (artifact.executionMode === 'unavailable') issue(context, 'An unavailable execution cannot produce an artifact.');
});
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const CheckSchema = z.object({
  checkId: CheckIdSchema, revisionId: IdSchema, ...requirementIdentity,
  geometryHash: HashSchema, executionMode: ExecutionModeSchema,
  state: z.enum(['passed', 'failed', 'not_evaluated']), label: z.string().min(1).max(200),
  method: z.string().min(1).max(4000), expected: JsonValueSchema, measured: JsonValueSchema,
  units: CheckUnitsSchema,
  details: shortText,
  diagnostics: z.object({
    pointPair: z.tuple([point3, point3]).optional(), pointPairs: z.array(z.tuple([point3, point3])).max(16).optional(),
    box: z.tuple([point3, point3]).optional(), message: shortText.optional(),
  }).strict().optional(),
}).strict().superRefine((check, context) => {
  try {
    const definition = checkDefinition(check.checkId, check.registryId);
    if (check.method !== definition.method || !sameJson(check.units, definition.units)) issue(context, 'Check method and units must match the frozen registry.');
  } catch { issue(context, 'Unknown registered check.'); }
  if (check.state !== 'not_evaluated' && (check.measured === null || check.executionMode === 'unavailable')) issue(context, 'Evaluated checks require measurements and an available execution.');
});
export type Check = z.infer<typeof CheckSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export const EngineSchema = z.object({
  name: z.enum(['build123d', 'FreeCAD', 'fixture']), version: z.string().min(1).max(100),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
const candidateIdentity = {
  runId: IdSchema, requestId: IdSchema, designId: IdSchema, attemptId: IdSchema,
  revisionId: IdSchema, inputRevisionId: IdSchema, ...requirementIdentity,
};
export const CandidateStatusSchema = z.enum(['building', 'checking', 'reviewable', 'rejected', 'superseded', 'failed']);
const candidateObject = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), ...candidateIdentity, units: UnitsSchema,
  requirements: RequirementsSchema, executionMode: ExecutionModeSchema, status: CandidateStatusSchema,
  createdAt: timestamp, updatedAt: timestamp, changeSummary: shortText,
  engine: EngineSchema.nullable(), sourceSha256: HashSchema.nullable(), proposalHash: HashSchema.nullable(),
  geometryHash: HashSchema.nullable(), checkBundleHash: HashSchema.nullable(),
  checks: z.array(CheckSchema).max(9), artifacts: z.array(ArtifactSchema).max(32), error: ErrorSchema.nullable(),
});
const bindingKeys = ['requirementsVersion', 'requirementsId', 'registryId', 'registryHash', 'setupId', 'setupHash', 'referenceHash', 'validatorVersion'] as const;
type RequirementIdentity = Record<Exclude<typeof bindingKeys[number], 'requirementsVersion'>, string> & { requirementsVersion: number };
function matchesRequirements(value: RequirementIdentity, requirements: Requirements): boolean {
  return bindingKeys.every(key => value[key] === requirements[key]);
}
function validateChecks(checks: Check[], requirements: Requirements, revisionId: string, geometryHash: string | null, executionMode: z.infer<typeof ExecutionModeSchema>, complete: boolean, context: z.RefinementCtx) {
  if (!RequirementsSchema.safeParse(requirements).success) return;
  const ids = checks.map(check => check.checkId);
  if (new Set(ids).size !== ids.length || ids.some(id => !requirements.requiredChecks.includes(id))
    || (complete && !sameJson([...ids].sort(), [...requirements.requiredChecks].sort()))) issue(context, 'Check set must match the immutable required check IDs.');
  for (const check of checks) {
    if (!matchesRequirements(check, requirements) || check.revisionId !== revisionId || check.geometryHash !== geometryHash || check.executionMode !== executionMode) issue(context, 'Check evidence identity mismatch.');
    if (requirements.requiredChecks.includes(check.checkId) && !sameJson(check.expected, expectedForCheck(requirements, check.checkId))) issue(context, 'Expected check values must come from immutable requirements.');
  }
}
function validateSealedArtifacts(artifacts: Array<{ kind: string; mediaType: string; sha256: string }>, geometryHash: string | null, sourceSha256: string | null, context: z.RefinementCtx) {
  if (!artifacts.some(artifact => artifact.mediaType === 'model/step' && artifact.sha256 === geometryHash)
    || !artifacts.some(artifact => artifact.kind === 'source' && artifact.sha256 === sourceSha256)
    || !artifacts.some(artifact => artifact.kind === 'editable')
    || !artifacts.some(artifact => artifact.mediaType === 'model/stl')) issue(context, 'Sealed evidence requires matching STEP and source plus editable and STL artifacts.');
}
export const CandidateSchema = candidateObject.strict().superRefine((candidate, context) => {
  if (!matchesRequirements(candidate, candidate.requirements) || candidate.designId !== candidate.requirements.designId) issue(context, 'Candidate requirements identity mismatch.');
  const complete = candidate.status === 'reviewable' || candidate.status === 'rejected';
  if (complete && (!candidate.engine || !candidate.sourceSha256 || !candidate.proposalHash || !candidate.geometryHash || !candidate.checkBundleHash || candidate.executionMode === 'unavailable')) issue(context, 'Completed candidates require sealed evidence.');
  validateChecks(candidate.checks, candidate.requirements, candidate.revisionId, candidate.geometryHash, candidate.executionMode, complete, context);
  if (candidate.status === 'reviewable' && (candidate.checks.some(check => check.state !== 'passed') || candidate.error !== null)) issue(context, 'Reviewable candidates require every check passed.');
  if (candidate.status === 'rejected' && candidate.checks.every(check => check.state === 'passed')) issue(context, 'Rejected candidates need a failed or unevaluated required check.');
  if (candidate.executionMode === 'live' && candidate.engine?.name === 'fixture') issue(context, 'Fixture engines cannot produce live evidence.');
  if (complete) validateSealedArtifacts(candidate.artifacts, candidate.geometryHash, candidate.sourceSha256, context);
  const ids = candidate.artifacts.map(artifact => artifact.artifactId);
  if (new Set(ids).size !== ids.length) issue(context, 'Duplicate artifact ID.');
  for (const artifact of candidate.artifacts) {
    if (!matchesRequirements(artifact, candidate.requirements) || artifact.runId !== candidate.runId || artifact.designId !== candidate.designId
      || artifact.revisionId !== candidate.revisionId || artifact.executionMode !== candidate.executionMode) issue(context, 'Artifact identity mismatch.');
  }
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const RunStatusSchema = z.enum(['queued', 'planning', 'running', 'completed', 'failed', 'superseded', 'cancelled']);
export const RunSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), runId: IdSchema, requestId: IdSchema, designId: IdSchema,
  inputRevisionId: IdSchema, ...requirementIdentity, units: UnitsSchema, instruction: shortText,
  status: RunStatusSchema, executionMode: ExecutionModeSchema,
  attemptIds: z.array(IdSchema).max(3), candidateRevisionIds: z.array(IdSchema).max(3),
  activeAttemptId: IdSchema.nullable(), createdAt: timestamp, updatedAt: timestamp, error: ErrorSchema.nullable(),
}).strict().superRefine((run, context) => {
  if (new Set(run.attemptIds).size !== run.attemptIds.length || new Set(run.candidateRevisionIds).size !== run.candidateRevisionIds.length) issue(context, 'Duplicate run attempt or candidate identity.');
  if (run.activeAttemptId !== null && !run.attemptIds.includes(run.activeAttemptId)) issue(context, 'Active attempt is not registered to this run.');
  if (['completed', 'failed', 'superseded', 'cancelled'].includes(run.status) && run.activeAttemptId !== null) issue(context, 'Terminal runs cannot have an active attempt.');
});
export const DesignSchema = z.object({
  designId: IdSchema, label: z.string().min(1).max(200), units: UnitsSchema, stateVersion: StateVersionSchema,
  referenceId: IdSchema, referenceHash: HashSchema, setupId: SetupIdSchema, setupHash: HashSchema,
  baselineRevisionId: IdSchema, activeRequirementsVersion: VersionSchema,
  acceptedRevisionId: IdSchema.nullable(), acceptedRequirementsMatch: z.boolean(),
  selectedCandidateRevisionId: IdSchema.nullable(), activeRunId: IdSchema.nullable(),
}).strict().superRefine((design, context) => {
  if (design.acceptedRevisionId === null && design.acceptedRequirementsMatch) issue(context, 'No accepted revision exists to match requirements.');
});
export const EventSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), eventId: VersionSchema, designId: IdSchema, stateVersion: StateVersionSchema,
  runId: IdSchema.nullable(), revisionId: IdSchema.nullable(), requirementsVersion: VersionSchema,
  units: UnitsSchema, executionMode: ExecutionModeSchema, createdAt: timestamp,
  type: z.enum(['run.queued', 'run.planning', 'run.running', 'run.completed', 'run.failed', 'run.superseded', 'run.cancelled', 'candidate.building', 'candidate.checking', 'candidate.reviewable', 'candidate.rejected', 'candidate.failed', 'candidate.superseded', 'requirements.updated', 'revision.accepted']),
  run: RunSchema.nullable(), candidate: CandidateSchema.nullable(), acceptanceId: IdSchema.nullable(),
}).strict().superRefine((event, context) => {
  if (event.run && (event.run.runId !== event.runId || event.run.designId !== event.designId || event.run.executionMode !== event.executionMode || event.run.requirementsVersion !== event.requirementsVersion)) issue(context, 'Event run identity mismatch.');
  if (event.candidate && (event.candidate.revisionId !== event.revisionId || event.candidate.runId !== event.runId || event.candidate.designId !== event.designId || event.candidate.executionMode !== event.executionMode || event.candidate.requirementsVersion !== event.requirementsVersion)) issue(context, 'Event candidate identity mismatch.');
  if ((event.type === 'revision.accepted') !== (event.acceptanceId !== null)) issue(context, 'Acceptance events require a distinct acceptance identity.');
});
export const BootstrapSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), scopeStatus: z.enum(['not_selected', 'selected']), executionMode: ExecutionModeSchema,
  design: DesignSchema.nullable(), requirements: RequirementsSchema.nullable(),
  runs: z.array(RunSchema).max(100), candidates: z.array(CandidateSchema).max(300), unavailableReason: z.string().min(1).max(300).nullable(),
}).strict().superRefine((bootstrap, context) => {
  const { design, requirements, runs, candidates } = bootstrap;
  if (bootstrap.scopeStatus === 'selected' && (!design || !requirements)) issue(context, 'Selected scope requires a design and requirements.');
  if ((design === null) !== (requirements === null)) issue(context, 'Design and requirements must be supplied together.');
  if (!design || !requirements) {
    if (runs.length || candidates.length) issue(context, 'Evidence requires a design.');
    return;
  }
  if (requirements.designId !== design.designId || requirements.requirementsVersion !== design.activeRequirementsVersion
    || requirements.setupId !== design.setupId || requirements.setupHash !== design.setupHash || requirements.referenceId !== design.referenceId || requirements.referenceHash !== design.referenceHash) issue(context, 'Design active requirements mismatch.');
  if (new Set(runs.map(run => run.runId)).size !== runs.length || new Set(candidates.map(candidate => candidate.revisionId)).size !== candidates.length) issue(context, 'Duplicate run or revision identity.');
  if (design.activeRunId !== null && !runs.some(run => run.runId === design.activeRunId && !['completed', 'failed', 'superseded', 'cancelled'].includes(run.status))) issue(context, 'Active run must be pending.');
  if (design.selectedCandidateRevisionId !== null && !candidates.some(candidate => candidate.revisionId === design.selectedCandidateRevisionId)) issue(context, 'Selected candidate is missing.');
  for (const run of runs) {
    if (run.designId !== design.designId || (bootstrap.executionMode !== 'unavailable' && run.executionMode !== bootstrap.executionMode)) issue(context, 'Bootstrap run identity or execution mode mismatch.');
  }
  for (const candidate of candidates) {
    const run = runs.find(value => value.runId === candidate.runId);
    if (!run || !run.candidateRevisionIds.includes(candidate.revisionId) || !run.attemptIds.includes(candidate.attemptId)
      || run.requestId !== candidate.requestId || run.inputRevisionId !== candidate.inputRevisionId || !matchesRequirements(run, candidate.requirements)) issue(context, 'Candidate is not bound to its run.');
    if (candidate.designId !== design.designId || (bootstrap.executionMode !== 'unavailable' && candidate.executionMode !== bootstrap.executionMode)) issue(context, 'Bootstrap candidate identity or execution mode mismatch.');
  }
});

export const InputArtifactSchema = z.object({
  artifactId: IdSchema, revisionId: IdSchema, kind: artifactKind, units: UnitsSchema, path: privatePath, sha256: HashSchema,
}).strict();
export const DispatchReferenceArtifactSchema = z.object({
  referenceId: IdSchema, artifactId: IdSchema, revisionId: IdSchema, kind: z.literal('reference'),
  units: UnitsSchema, path: privatePath, sha256: HashSchema,
  datumSpec: z.object({ path: privatePath, sha256: HashSchema }).strict().optional(),
}).strict();
export type DispatchReferenceArtifact = z.infer<typeof DispatchReferenceArtifactSchema>;
export const ToolInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), runId: IdSchema, requestId: IdSchema, designId: IdSchema,
  inputRevisionId: IdSchema, outputRevisionId: IdSchema, attemptId: IdSchema, units: UnitsSchema,
  requirements: RequirementsSchema, registryCanonicalJson: z.string().min(1).max(32768), setupCanonicalJson: z.string().min(1).max(16384),
  proposal: ProviderProposalSchema, outputDir: privatePath,
  deadline: timestamp.optional(), remainingBudgetMs: z.number().int().positive().max(180000).optional(),
  referenceArtifact: DispatchReferenceArtifactSchema.optional(),
  inputArtifacts: z.array(InputArtifactSchema).max(16),
}).strict().superRefine((input, context) => {
  if (input.deadline === undefined && input.remainingBudgetMs === undefined) issue(context, 'A tool deadline or remaining budget is required.');
  if (input.designId !== input.requirements.designId || input.registryCanonicalJson !== input.requirements.registryCanonicalJson || input.setupCanonicalJson !== input.requirements.setupCanonicalJson) issue(context, 'Tool requirements and canonical bytes mismatch.');
  if (input.inputRevisionId === input.outputRevisionId || input.inputArtifacts.some(artifact => artifact.revisionId !== input.inputRevisionId)) issue(context, 'Tool input and output revision binding mismatch.');
  const r = input.requirements, reference = input.referenceArtifact;
  if (new Set(input.inputArtifacts.map(artifact => artifact.artifactId)).size !== input.inputArtifacts.length) issue(context, 'Duplicate input artifact ID.');
  if (r.registryId === 'handle_sample_v1') {
    const fixed = r.setup.reference, accepted = r.setup.acceptedInitial;
    if (!reference || reference.referenceId !== fixed.referenceId || reference.revisionId !== fixed.revisionId
      || reference.sha256 !== fixed.stepSha256 || reference.datumSpec?.sha256 !== fixed.datumSpecSha256) issue(context, 'Handle dispatch requires the original mount reference and fixed datum.');
    if (accepted === null) {
      if (input.inputRevisionId !== fixed.revisionId || input.inputArtifacts.length !== 0) issue(context, 'Initial handle uses only the fixed reference.');
    } else if (input.inputRevisionId !== accepted.revisionId || input.inputArtifacts.filter(artifact =>
      artifact.artifactId === accepted.artifactId && artifact.revisionId === accepted.revisionId
      && artifact.sha256 === accepted.sha256 && artifact.kind === 'export').length !== 1) {
      issue(context, 'Refinement requires the exact accepted initial STEP descriptor.');
    }
    if (reference && input.inputArtifacts.some(artifact => artifact.artifactId === reference.artifactId)) issue(context, 'Reference and current input artifacts must be distinct.');
  } else if (reference) {
    if (reference.referenceId !== r.referenceId || reference.revisionId !== 'baseline_50'
      || reference.sha256 !== r.referenceHash || reference.datumSpec !== undefined) issue(context, 'Plate reference must retain its original baseline identity.');
  } else {
    // Only preregistered baseline transports retain the old embedded-reference shape.
    const baseline = input.inputArtifacts[0];
    const originalBaseline = input.inputRevisionId === 'baseline_50' && baseline?.sha256 === r.referenceHash;
    const transportFixture = input.inputRevisionId === 'fixture_baseline_50'
      && baseline?.artifactId === 'fixture_reference_step' && baseline.sha256 === r.referenceHash;
    if (input.inputArtifacts.length !== 1 || baseline?.kind !== 'reference'
      || !(originalBaseline || transportFixture)) {
      issue(context, 'Non-baseline plate dispatch requires an explicit fixed reference.');
    }
  }
  if (input.proposal.kind === 'numeric_operation' && (input.requirements.registryId !== 'plate_requirements_v1' || input.requirements.setupId !== 'resize_centered_v1' || input.proposal.operation.parameters.lengthMm !== input.requirements.setup.dimensions.lengthMm)) issue(context, 'Numeric operation must match the confirmed resize requirements.');
});
export const PrivateArtifactSchema = z.object({
  path: privatePath, kind: artifactKind, fileName, mediaType, bytes, sha256: HashSchema, executionMode: z.enum(['live', 'fixture']),
}).strict();
export const ToolResultSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), runId: IdSchema, requestId: IdSchema, designId: IdSchema,
  inputRevisionId: IdSchema, outputRevisionId: IdSchema, attemptId: IdSchema, units: UnitsSchema,
  ...requirementIdentity, requirements: RequirementsSchema, executionMode: ExecutionModeSchema,
  status: z.enum(['completed', 'failed', 'unavailable']), proposal: ProviderProposalSchema,
  proposalHash: HashSchema, sourceSha256: HashSchema.nullable(), engine: EngineSchema.nullable(),
  geometryHash: HashSchema.nullable(), checkBundleHash: HashSchema.nullable(), checks: z.array(CheckSchema).max(9),
  artifacts: z.array(PrivateArtifactSchema).max(32), error: ErrorSchema.nullable(),
}).strict().superRefine((result, context) => {
  if (!matchesRequirements(result, result.requirements) || result.designId !== result.requirements.designId || result.inputRevisionId === result.outputRevisionId) issue(context, 'Tool result identity mismatch.');
  if (result.status === 'completed' && (!result.engine || !result.sourceSha256 || !result.geometryHash || !result.checkBundleHash || result.error !== null || result.executionMode === 'unavailable')) issue(context, 'Completed tools require sealed evidence.');
  if (result.status !== 'completed' && result.error === null) issue(context, 'Failed or unavailable tools require a safe error.');
  if (result.executionMode === 'live' && result.engine?.name === 'fixture') issue(context, 'Fixture engine cannot produce live evidence.');
  validateChecks(result.checks, result.requirements, result.outputRevisionId, result.geometryHash, result.executionMode, result.status === 'completed', context);
  if (result.status === 'completed') validateSealedArtifacts(result.artifacts, result.geometryHash, result.sourceSha256, context);
  if (result.artifacts.some(artifact => artifact.executionMode !== result.executionMode)) issue(context, 'Tool artifact execution mode mismatch.');
  if (result.proposal.kind === 'numeric_operation' && (result.requirements.registryId !== 'plate_requirements_v1' || result.requirements.setupId !== 'resize_centered_v1' || result.proposal.operation.parameters.lengthMm !== result.requirements.setup.dimensions.lengthMm)) issue(context, 'Tool numeric operation does not match requirements.');
});
export type ToolInputData = z.infer<typeof ToolInputSchema>;
export type ToolInput = ToolInputData & { signal: AbortSignal };
export type InputArtifact = z.infer<typeof InputArtifactSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ToolAdapter = (input: ToolInput) => Promise<ToolResult>;
export type RunRequest = z.infer<typeof RunRequestSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Design = z.infer<typeof DesignSchema>;
export type Event = z.infer<typeof EventSchema>;
export type RunEvent = Event;
export type Bootstrap = z.infer<typeof BootstrapSchema>;
export type AcceptanceRequest = z.infer<typeof AcceptanceRequestSchema>;
export type RequirementsUpdateRequest = z.infer<typeof RequirementsUpdateRequestSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export type CheckBundleInput = Pick<Candidate, keyof typeof candidateIdentity | 'contractVersion' | 'units' | 'engine' | 'sourceSha256' | 'proposalHash' | 'geometryHash' | 'executionMode' | 'checks'>;
/** One explicit mapping shared by BACKEND and TOOLS. Never hash only passage flags. */
export function checkBundleHashPayload(input: CheckBundleInput): JsonValue {
  if (!input.geometryHash || !input.engine || !input.sourceSha256 || !input.proposalHash) throw new Error('Check bundles require sealed geometry and source identities.');
  return {
    contractVersion: input.contractVersion, designId: input.designId, runId: input.runId, requestId: input.requestId,
    attemptId: input.attemptId, revisionId: input.revisionId, inputRevisionId: input.inputRevisionId,
    requirementsId: input.requirementsId, requirementsVersion: input.requirementsVersion,
    registryId: input.registryId, registryHash: input.registryHash, setupId: input.setupId, setupHash: input.setupHash,
    referenceHash: input.referenceHash, validatorVersion: input.validatorVersion, units: input.units,
    executionMode: input.executionMode, engine: input.engine, sourceSha256: input.sourceSha256,
    proposalHash: input.proposalHash, geometryHash: input.geometryHash, checks: input.checks,
  };
}
export async function computeCheckBundleHash(input: CheckBundleInput): Promise<string> {
  return hashCanonical(checkBundleHashPayload(input));
}
export async function verifyCandidateEvidence(input: unknown): Promise<Candidate> {
  const candidate = CandidateSchema.parse(input);
  await verifyRequirements(candidate.requirements);
  if (candidate.checkBundleHash !== null && await computeCheckBundleHash(candidate) !== candidate.checkBundleHash) throw new Error('Check bundle hash mismatch.');
  return candidate;
}
export async function verifyToolInput(input: unknown): Promise<ToolInputData> {
  const data = ToolInputSchema.parse(input);
  await verifyRequirements(data.requirements);
  return data;
}
export async function verifyToolResult(input: unknown, expectedInput: ToolInputData): Promise<ToolResult> {
  const result = ToolResultSchema.parse(input);
  const expected = await verifyToolInput(expectedInput);
  await verifyRequirements(result.requirements);
  const echoKeys = ['contractVersion', 'runId', 'requestId', 'designId', 'inputRevisionId', 'outputRevisionId', 'attemptId', 'units'] as const;
  if (echoKeys.some(key => result[key] !== expected[key]) || !sameJson(result.requirements, expected.requirements)
    || !sameJson(result.proposal, expected.proposal)) throw new Error('Tool result does not match its dispatched input.');
  if (await hashCanonical(result.proposal) !== result.proposalHash) throw new Error('Tool proposal hash mismatch.');
  if (result.proposal.kind === 'python_source' && result.sourceSha256 !== null && await sha256(result.proposal.source) !== result.sourceSha256) throw new Error('Tool source hash mismatch.');
  if (result.checkBundleHash !== null && await computeCheckBundleHash({ ...result, revisionId: result.outputRevisionId }) !== result.checkBundleHash) throw new Error('Tool check bundle hash mismatch.');
  return result;
}
