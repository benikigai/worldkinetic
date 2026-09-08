import { z } from 'zod';
import registryData from '../../fixtures/api/handle-requirement-registry.json' with { type: 'json' };
import { canonicalize, sha256, type JsonValue } from './canonical-json.js';
import { CONTRACT_VERSION, IdSchema, HashSchema, VersionSchema, UnitsSchema, CheckIdSchema, CheckUnitsSchema } from './requirement-primitives.js';

export const HANDLE_REGISTRY_CANONICAL_JSON = canonicalize(registryData);
export const HANDLE_REGISTRY_HASH = 'b71ce9b567c33e3070ada344a581777b326d313da4eab205b4878383f0d310ce';
export const HANDLE_REGISTRY_FILE_SHA256 = '6c1ae7ca15127d45146fc4c27e9659c206e9d7b77d1f7b925e0d7a54c60a4c7c';
const registry: typeof registryData = JSON.parse(HANDLE_REGISTRY_CANONICAL_JSON);
const geometry = registry.geometry;
export const HandleSetupIdSchema = z.enum(['handle_initial_v1', 'handle_refine_v1']);

// Only the fixed frame, two pads, axes and envelope belong to the reference, never a grip.
export const HANDLE_DATUM_CANONICAL_JSON = canonicalize({
  referenceId: 'handle_mount_v1', revisionId: 'handle_mount_reference_v1', units: 'mm',
  frame: geometry.frame, axesMm: geometry.mounting.axesMm, axisDirection: geometry.mounting.axisDirection,
  padRadiusMm: geometry.mounting.padRadiusMm, padZRangeMm: geometry.mounting.padZRangeMm,
  referenceKind: geometry.mounting.referenceKind, referenceSolidCount: geometry.mounting.referenceSolidCount,
  referenceContainsHandle: geometry.mounting.referenceContainsHandle, assumedEnvelopeMm: geometry.assumedEnvelopeMm,
});
export const HANDLE_DATUM_SHA256 = '6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83';
export const HandleReferenceSchema = z.object({
  referenceId: z.literal('handle_mount_v1'), revisionId: z.literal('handle_mount_reference_v1'),
  stepSha256: HashSchema, datumSpecSha256: z.literal(HANDLE_DATUM_SHA256),
}).strict();
/** Descriptor binding only. The store must resolve it from immutable acceptance history. */
export const AcceptedInitialSchema = z.object({
  acceptanceId: IdSchema, revisionId: IdSchema, artifactId: IdSchema, sha256: HashSchema,
  requirementsId: IdSchema, requirementsVersion: VersionSchema, setupHash: HashSchema,
  sourceSha256: HashSchema, checkBundleHash: HashSchema,
}).strict().refine(value => value.revisionId !== 'handle_mount_reference_v1', 'Accepted initial cannot be the mount reference.');
export type AcceptedInitial = z.infer<typeof AcceptedInitialSchema>;
const frozenGeometry = z.custom<typeof geometry>((value: unknown) => {
  try { return canonicalize(value) === canonicalize(geometry); } catch { return false; }
}, 'Geometry controls must equal the frozen handle registry.');
export const HandleResolvedSetupSchema = z.object({
  setupId: HandleSetupIdSchema, registryId: z.literal('handle_sample_v1'), registryHash: z.literal(HANDLE_REGISTRY_HASH),
  units: UnitsSchema, referenceId: z.literal('handle_mount_v1'), referenceHash: HashSchema,
  reference: HandleReferenceSchema, geometry: frozenGeometry,
  acceptedInitial: AcceptedInitialSchema.nullable(), requiredChecks: z.array(CheckIdSchema).min(8).max(9),
}).strict().superRefine((setup, context) => {
  const checks = setup.setupId === 'handle_initial_v1' ? geometry.requiredInitialChecks
    : [...geometry.requiredInitialChecks, ...geometry.additionalRefinementChecks];
  if (setup.referenceHash !== setup.reference.stepSha256
    || (setup.setupId === 'handle_initial_v1') !== (setup.acceptedInitial === null)
    || canonicalize([...setup.requiredChecks].sort()) !== canonicalize([...checks].sort())) {
    context.addIssue({ code: 'custom', message: 'Handle setup reference, stage or required checks mismatch.' });
  }
});
export type HandleResolvedSetup = z.infer<typeof HandleResolvedSetupSchema>;
export const HandleRequirementsSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requirementsId: IdSchema, designId: IdSchema,
  requirementsVersion: VersionSchema, units: UnitsSchema,
  registryId: z.literal('handle_sample_v1'), registryHash: z.literal(HANDLE_REGISTRY_HASH), registryFileSha256: z.literal(HANDLE_REGISTRY_FILE_SHA256),
  setupId: HandleSetupIdSchema, setupHash: HashSchema, referenceId: z.literal('handle_mount_v1'), referenceHash: HashSchema,
  validatorVersion: IdSchema, requiredChecks: z.array(CheckIdSchema).min(8).max(9), setup: HandleResolvedSetupSchema,
  registryCanonicalJson: z.literal(HANDLE_REGISTRY_CANONICAL_JSON), setupCanonicalJson: z.string().min(1).max(16384),
}).strict().superRefine((value, context) => {
  if (value.setupId !== value.setup.setupId || value.referenceHash !== value.setup.referenceHash
    || value.setupCanonicalJson !== canonicalize(value.setup)
    || canonicalize([...value.requiredChecks].sort()) !== canonicalize([...value.setup.requiredChecks].sort())
    || (value.setup.acceptedInitial !== null && value.requirementsVersion <= value.setup.acceptedInitial.requirementsVersion)) {
    context.addIssue({ code: 'custom', message: 'Handle requirements must bind the exact setup and a newer refinement version.' });
  }
});
export type HandleRequirements = z.infer<typeof HandleRequirementsSchema>;
export const CreateHandleRequirementsInputSchema = z.discriminatedUnion('setupId', [
  z.object({ designId: IdSchema, requirementsVersion: VersionSchema, setupId: z.literal('handle_initial_v1'),
    reference: HandleReferenceSchema, validatorVersion: IdSchema.optional() }).strict(),
  z.object({ designId: IdSchema, requirementsVersion: VersionSchema, setupId: z.literal('handle_refine_v1'),
    reference: HandleReferenceSchema, acceptedInitial: AcceptedInitialSchema, validatorVersion: IdSchema.optional() }).strict(),
]);
export type CreateHandleRequirementsInput = z.infer<typeof CreateHandleRequirementsInputSchema>;

/** Trusted contract construction, not proof that a descriptor was accepted by the store. */
export async function createHandleRequirements(input: CreateHandleRequirementsInput): Promise<HandleRequirements> {
  const data = CreateHandleRequirementsInputSchema.parse(input);
  const setup = HandleResolvedSetupSchema.parse({
    setupId: data.setupId, registryId: registry.registryId, registryHash: HANDLE_REGISTRY_HASH, units: 'mm',
    referenceId: data.reference.referenceId, referenceHash: data.reference.stepSha256, reference: data.reference,
    geometry: JSON.parse(canonicalize(geometry)),
    acceptedInitial: data.setupId === 'handle_refine_v1' ? data.acceptedInitial : null,
    requiredChecks: data.setupId === 'handle_initial_v1' ? geometry.requiredInitialChecks : [...geometry.requiredInitialChecks, ...geometry.additionalRefinementChecks],
  });
  const setupCanonicalJson = canonicalize(setup), setupHash = await sha256(setupCanonicalJson);
  if (await sha256(HANDLE_REGISTRY_CANONICAL_JSON) !== HANDLE_REGISTRY_HASH
    || await sha256(HANDLE_DATUM_CANONICAL_JSON) !== HANDLE_DATUM_SHA256) throw new Error('Handle registry or datum identity changed.');
  const validatorVersion = data.validatorVersion ?? 'handle-validator-v1';
  const requirementsId = `req_${(await sha256(canonicalize({ designId: data.designId, requirementsVersion: data.requirementsVersion, setupHash, validatorVersion }))).slice(0, 32)}`;
  return HandleRequirementsSchema.parse({
    contractVersion: CONTRACT_VERSION, requirementsId, designId: data.designId, requirementsVersion: data.requirementsVersion,
    units: 'mm', registryId: registry.registryId, registryHash: HANDLE_REGISTRY_HASH, registryFileSha256: HANDLE_REGISTRY_FILE_SHA256,
    setupId: data.setupId, setupHash, referenceId: setup.referenceId, referenceHash: setup.referenceHash,
    validatorVersion, requiredChecks: setup.requiredChecks, setup, registryCanonicalJson: HANDLE_REGISTRY_CANONICAL_JSON, setupCanonicalJson,
  });
}

export function handleCheckDefinition(checkId: string): { method: string; units: z.infer<typeof CheckUnitsSchema> } {
  if (!Object.hasOwn(registry.checks, checkId)) throw new Error('Unknown handle check.');
  const definition = registry.checks[checkId as keyof typeof registry.checks];
  return { method: definition.method, units: CheckUnitsSchema.parse(definition.units) };
}

export function expectedForHandleCheck(requirements: HandleRequirements, checkId: string): JsonValue {
  const r = HandleRequirementsSchema.parse(requirements), g = r.setup.geometry;
  if (!r.requiredChecks.includes(checkId)) throw new Error('Check is not required by this handle stage.');
  const initial = r.setupId === 'handle_initial_v1';
  const exportCommon = {
    linearMm: g.tolerances.linearMm, differenceVolumeMm3: g.tolerances.differenceVolumeMm3,
    relativeVolume: g.tolerances.stepRelativeVolume, validSingleSolid: true,
    handleChecksMatch: g.requiredInitialChecks.filter(id => !id.startsWith('export.')).concat(initial ? [] : g.additionalRefinementChecks),
    referenceHash: r.referenceHash, datumSpecSha256: r.setup.reference.datumSpecSha256,
  };
  const values: Record<string, JsonValue> = {
    'geometry.valid_single_solid': { requirementFields: ['registry.checks.geometry.valid_single_solid'], solidCount: 1, valid: true, connected: true, nonempty: true, finiteBounds: true, positiveFiniteVolume: true },
    'handle.mount_interface': { requirementFields: ['setup.geometry.mounting', 'setup.geometry.sampleRequirements', 'setup.reference', 'setup.geometry.tolerances'], mounting: g.mounting, mountPitchMm: g.sampleRequirements.mountPitchMm, panelHoleDiameterMm: g.sampleRequirements.panelHoleDiameterMm, panelHoleCount: g.sampleRequirements.panelHoleCount, reference: r.setup.reference, maximumRemovedPadVolumeMm3: g.tolerances.differenceVolumeMm3, linearMm: g.tolerances.linearMm },
    'handle.envelope': { requirementFields: ['setup.geometry.assumedEnvelopeMm', 'setup.geometry.sampleRequirements.maximumOverallLengthMm'], envelopeMm: g.assumedEnvelopeMm, maximumOverallLengthMm: g.sampleRequirements.maximumOverallLengthMm, linearMm: g.tolerances.linearMm },
    'handle.grip_clearance': { requirementFields: ['setup.geometry.grip', 'setup.geometry.sampleRequirements.minimumFingerGapMm'], centralXRangeMm: g.grip.centralXRangeMm, centralYRangeMm: g.grip.centralYRangeMm, emptyBelowZmm: g.grip.emptyBelowZmm, minimumFingerGapMm: g.sampleRequirements.minimumFingerGapMm, strictEmptyGap: g.grip.strictEmptyGap, gapKernelInsetMm: g.grip.gapKernelInsetMm, allowedIntersectingSolids: g.grip.allowedIntersectingSolids, strictMinimumGapUsesLinearSlack: g.tolerances.strictMinimumGapUsesLinearSlack },
    'handle.grip_sections': { requirementFields: ['setup.geometry.grip', 'setup.geometry.tolerances'], centralXRangeMm: g.grip.centralXRangeMm, centralYRangeMm: g.grip.centralYRangeMm, centralZRangeMm: g.grip.centralZRangeMm, clippedSolidCount: g.grip.clippedSolidCount, requiredXSpanMm: g.grip.requiredXSpanMm, sectionStationsXmm: g.grip.sectionStationsXmm, sectionConnectedFaceCount: g.grip.sectionConnectedFaceCount, initialYRangeMm: initial ? g.grip.initialYRangeMm : null, initialStationWidthRangeMm: initial ? g.grip.initialStationWidthRangeMm : null, linearMm: g.tolerances.linearMm, sectionAreaMm2: g.tolerances.sectionAreaMm2 },
    'handle.refinement_delta': { requirementFields: ['setup.geometry.refinement', 'setup.acceptedInitial', 'setup.geometry.tolerances'], refinement: g.refinement, acceptedInitial: r.setup.acceptedInitial, tolerances: g.tolerances, sectionStationsXmm: g.grip.sectionStationsXmm },
    'export.step_reopen': { requirementFields: ['registry.checks.export.step_reopen', 'setup.geometry.tolerances'], ...exportCommon, sealedByteIdentity: true },
    'export.stl_reopen': { requirementFields: ['registry.checks.export.stl_reopen', 'setup.geometry.tolerances'], ...exportCommon, relativeVolume: g.tolerances.stlRelativeVolume, finiteVertices: true, watertight: true, connected: true, consistentlyOriented: true, positiveVolume: true, manifestUnits: 'mm' },
    'export.editable_reopen': { requirementFields: ['registry.checks.export.editable_reopen', 'setup.geometry.tolerances', 'setup.acceptedInitial'], ...exportCommon, isolatedReopenOrRegeneration: true, acceptedInitial: r.setup.acceptedInitial },
  };
  return values[checkId]!;
}
