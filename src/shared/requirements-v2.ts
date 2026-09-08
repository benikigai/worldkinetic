import { z } from 'zod';
import registryData from '../../fixtures/api/requirement-registry.json' with { type: 'json' };
import { canonicalize, parseStrictJson, sha256, type JsonValue } from './canonical-json.js';

export const CONTRACT_VERSION = 'wk-prototype-0.2' as const;
export const REGISTRY_FILE_SHA256 = 'd9de0bbe0c6a03f101d5f9562360ac10d0a4216401533eb9be0b4148c8a9aa33';
export const REGISTRY_HASH = '593ece1f1387e766f0e80bdabc45ab6ad46c6301e8d1421f8a05d8a06f657f7d';
export const REGISTRY_CANONICAL_JSON = canonicalize(registryData);
export const DEFAULT_VALIDATOR_VERSION = 'plate-validator-v1';
// Keep a private snapshot so mutation of a consumer's JSON import cannot change requirements.
const registry: typeof registryData = JSON.parse(REGISTRY_CANONICAL_JSON);
export const IdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const StateVersionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const UnitsSchema = z.literal('mm');
export const ExecutionModeSchema = z.enum(['fixture', 'live', 'unavailable']);
export const SetupIdSchema = z.enum(['resize_centered_v1', 'tactile_feature_v1']);
export const CheckIdSchema = z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
export const CheckUnitsSchema = z.array(z.enum(['mm', 'mm3', 'count', 'ratio', 'SHA-256'])).min(1).max(4);
export const LengthMmSchema = z.number().finite().min(26).max(200);
export const JsonValueSchema = z.custom<JsonValue>((value: unknown) => {
  try { canonicalize(value); return true; } catch { return false; }
}, 'Expected finite JSON data.');
const point = z.tuple([z.number().finite(), z.number().finite()]);
const range = z.tuple([z.number().finite(), z.number().finite()]);
const dimensions = z.object({ lengthMm: LengthMmSchema, widthMm: z.literal(35), baseThicknessMm: z.literal(5) }).strict();
const holes = z.object({
  centersMode: z.enum(['centered', 'fixed']), centersMm: z.tuple([point, point]),
  diameterMm: z.literal(6), spacingMm: z.literal(20),
}).strict();
const tolerances = z.object({
  linearMm: z.literal(0.01), differenceVolumeMm3: z.literal(0.01),
  stepRelativeVolume: z.literal(0.00001), stlRelativeVolume: z.literal(0.001),
}).strict();
export const ResolvedSetupSchema = z.object({
  setupId: SetupIdSchema, registryId: z.literal('plate_requirements_v1'), registryHash: z.literal(REGISTRY_HASH),
  units: UnitsSchema,
  frame: z.object({ handedness: z.literal('right'), z: z.literal('up'), x: z.literal('length'), y: z.literal('width'), origin: z.literal('min_plate_corner') }).strict(),
  referenceId: z.literal('plate_revised_50x35x5'), referenceHash: z.literal(registry.referenceHashes.revisedStep),
  referenceHashes: z.object({
    originalNative: z.literal(registry.referenceHashes.originalNative), revisedNative: z.literal(registry.referenceHashes.revisedNative), revisedStep: z.literal(registry.referenceHashes.revisedStep),
  }).strict(),
  referenceTransform: z.tuple([z.literal(1), z.literal(0), z.literal(0), z.literal(0), z.literal(0), z.literal(1), z.literal(0), z.literal(0), z.literal(0), z.literal(0), z.literal(1), z.literal(0), z.literal(0), z.literal(0), z.literal(0), z.literal(1)]),
  dimensions, holes, minimumEndMaterialMm: z.literal(5), tolerances,
  protectedRegions: z.object({ kind: z.literal('z_cylinders'), centersMm: z.tuple([point, point]), radiusMm: z.literal(4), zRangeMm: range }).strict().nullable(),
  keepOutRegions: z.null(), profileId: z.null(),
  feature: z.object({
    allowedBoxMm: z.tuple([range, range, range]), addedSpanRangesMm: z.tuple([range, range, range]),
    minimumAddedVolumeExclusiveMm3: z.literal(1), preserveAllBaselineMaterial: z.literal(true), unobstructedBores: z.literal('full_candidate_extent'),
  }).strict().nullable(),
  requiredChecks: z.array(CheckIdSchema).min(7).max(9),
}).strict();
export type ResolvedSetup = z.infer<typeof ResolvedSetupSchema>;

export function resolveSetup(setupId: z.infer<typeof SetupIdSchema>, lengthMm?: number): ResolvedSetup {
  SetupIdSchema.parse(setupId);
  if (setupId === 'tactile_feature_v1' && lengthMm !== undefined) throw new Error('Feature setup dimensions are frozen.');
  const template = registry.setups[setupId];
  const length = LengthMmSchema.parse(lengthMm ?? template.dimensions.lengthMm);
  const feature = setupId === 'tactile_feature_v1' ? registry.setups.tactile_feature_v1 : null;
  return ResolvedSetupSchema.parse({
    setupId, registryId: registry.registryId, registryHash: REGISTRY_HASH, units: registry.units,
    frame: registry.frame, referenceId: 'plate_revised_50x35x5', referenceHash: registry.referenceHashes.revisedStep,
    referenceHashes: registry.referenceHashes,
    referenceTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    dimensions: { ...template.dimensions, lengthMm: length },
    holes: { ...template.holes, centersMm: feature ? feature.holes.centersMm : [[(length - 20) / 2, 17.5], [(length + 20) / 2, 17.5]] },
    minimumEndMaterialMm: template.minimumEndMaterialMm, tolerances: registry.tolerances,
    protectedRegions: feature?.protectedRegions ?? null, feature: feature?.feature ?? null,
    keepOutRegions: null, profileId: null, requiredChecks: template.requiredChecks,
  });
}

export const RequirementsSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requirementsId: IdSchema, designId: IdSchema,
  requirementsVersion: VersionSchema, units: UnitsSchema,
  registryId: z.literal('plate_requirements_v1'), registryHash: z.literal(REGISTRY_HASH), registryFileSha256: z.literal(REGISTRY_FILE_SHA256),
  setupId: SetupIdSchema, setupHash: HashSchema,
  referenceId: z.literal('plate_revised_50x35x5'), referenceHash: z.literal(registry.referenceHashes.revisedStep),
  validatorVersion: IdSchema, requiredChecks: z.array(CheckIdSchema).min(7).max(9),
  setup: ResolvedSetupSchema, registryCanonicalJson: z.literal(REGISTRY_CANONICAL_JSON), setupCanonicalJson: z.string().min(1).max(16384),
}).strict().superRefine((value, context) => {
  let matches = false;
  try {
    const expected = resolveSetup(value.setupId, value.setupId === 'resize_centered_v1' ? value.setup.dimensions.lengthMm : undefined);
    matches = canonicalize(value.setup) === canonicalize(expected) && value.setupCanonicalJson === canonicalize(expected)
      && canonicalize({ requiredChecks: value.requiredChecks }) === canonicalize({ requiredChecks: expected.requiredChecks });
  } catch { matches = false; }
  if (!matches) {
    context.addIssue({ code: 'custom', message: 'Requirements must match the immutable resolved registry setup.' });
  }
});
export type Requirements = z.infer<typeof RequirementsSchema>;
export const CreateRequirementsInputSchema = z.object({
  designId: IdSchema, requirementsVersion: VersionSchema, setupId: SetupIdSchema,
  lengthMm: LengthMmSchema.optional(), validatorVersion: IdSchema.optional(),
}).strict();
export type CreateRequirementsInput = z.infer<typeof CreateRequirementsInputSchema>;

/** Trusted server callable after confirmation; providers have no requirements mutation interface. */
export async function createRequirements(input: CreateRequirementsInput): Promise<Requirements> {
  const data = CreateRequirementsInputSchema.parse(input);
  const setup = resolveSetup(data.setupId, data.lengthMm);
  const setupCanonicalJson = canonicalize(setup);
  const setupHash = await sha256(setupCanonicalJson);
  if (await sha256(REGISTRY_CANONICAL_JSON) !== REGISTRY_HASH) throw new Error('Registry semantic identity changed.');
  const validatorVersion = data.validatorVersion ?? DEFAULT_VALIDATOR_VERSION;
  const requirementsId = `req_${(await sha256(canonicalize({ designId: data.designId, requirementsVersion: data.requirementsVersion, setupHash, validatorVersion }))).slice(0, 32)}`;
  return RequirementsSchema.parse({
    contractVersion: CONTRACT_VERSION, requirementsId, designId: data.designId, requirementsVersion: data.requirementsVersion,
    units: 'mm', registryId: registry.registryId, registryHash: REGISTRY_HASH, registryFileSha256: REGISTRY_FILE_SHA256,
    setupId: data.setupId, setupHash, referenceId: setup.referenceId, referenceHash: setup.referenceHash,
    validatorVersion, requiredChecks: setup.requiredChecks,
    setup, registryCanonicalJson: REGISTRY_CANONICAL_JSON, setupCanonicalJson,
  });
}

/** Required at trust boundaries. Structural parsing alone cannot verify SHA-256 asynchronously. */
export async function verifyRequirements(input: unknown): Promise<Requirements> {
  const requirements = RequirementsSchema.parse(input);
  if (await sha256(requirements.registryCanonicalJson) !== requirements.registryHash
    || await sha256(requirements.setupCanonicalJson) !== requirements.setupHash) throw new Error('Requirements hash mismatch.');
  // Strict parsing also rejects duplicate keys if canonical bytes originate outside TypeScript.
  parseStrictJson(requirements.registryCanonicalJson);
  parseStrictJson(requirements.setupCanonicalJson);
  return requirements;
}

export function checkDefinition(checkId: string): { method: string; units: z.infer<typeof CheckUnitsSchema> } {
  if (!Object.hasOwn(registry.checks, checkId)) throw new Error('Unknown registered check.');
  const definition = registry.checks[checkId as keyof typeof registry.checks];
  return { method: definition.method, units: CheckUnitsSchema.parse(definition.units) };
}

/** Expected values always come from the frozen requirements, never a provider/tool threshold. */
export function expectedForCheck(requirements: Requirements, checkId: string): JsonValue {
  const r = RequirementsSchema.parse(requirements);
  if (!r.requiredChecks.includes(checkId)) throw new Error('Check is not required by this setup.');
  const s = r.setup;
  const commonExport = { linearMm: s.tolerances.linearMm, differenceVolumeMm3: s.tolerances.differenceVolumeMm3, relativeVolume: s.tolerances.stepRelativeVolume };
  const values: Record<string, JsonValue> = {
    'geometry.valid_single_solid': { requirementFields: ['registry.checks.geometry.valid_single_solid'], solidCount: 1, valid: true, connected: true, nonempty: true, finiteBounds: true, positiveFiniteVolume: true },
    'geometry.requested_dimensions': { requirementFields: ['setup.dimensions', 'setup.feature', 'setup.tolerances.linearMm'], dimensions: s.dimensions, boundsMm: [[0, s.dimensions.lengthMm], [0, 35], [0, s.feature ? 7 : 5]], linearMm: s.tolerances.linearMm },
    'holes.layout': { requirementFields: ['setup.holes', 'setup.tolerances.linearMm'], ...s.holes, axis: 'Z', unobstructedBores: 'full_candidate_extent', linearMm: s.tolerances.linearMm },
    'margin.end_material': { requirementFields: ['setup.minimumEndMaterialMm', 'setup.tolerances.linearMm'], minimumEndMaterialMm: s.minimumEndMaterialMm, linearMm: s.tolerances.linearMm },
    'export.step_reopen': { requirementFields: ['registry.checks.export.step_reopen', 'setup.tolerances'], ...commonExport, sealedByteIdentity: true, validSingleSolid: true, dimensionsAndHolesMatch: true },
    'export.stl_reopen': { requirementFields: ['registry.checks.export.stl_reopen', 'setup.tolerances'], linearMm: s.tolerances.linearMm, relativeVolume: s.tolerances.stlRelativeVolume, finiteVertices: true, watertight: true, connected: true, consistentlyOriented: true, positiveVolume: true, dimensionsAndHolesMatch: true, unobstructedBores: 'full_candidate_extent', manifestUnits: 'mm' },
    'export.editable_reopen': { requirementFields: ['registry.checks.export.editable_reopen', 'setup.tolerances'], ...commonExport, isolatedReopenOrRegeneration: true, validSingleSolid: true, dimensionsAndHolesMatch: true },
    'interface.protected_region': { requirementFields: ['setup.protectedRegions', 'setup.tolerances.differenceVolumeMm3'], protectedRegions: s.protectedRegions, maximumDifferenceVolumeMm3: s.tolerances.differenceVolumeMm3, maximumRemovedVolumeMm3: s.tolerances.differenceVolumeMm3, unobstructedBores: 'full_candidate_extent' },
    'feature.requested_change': { requirementFields: ['setup.feature', 'setup.tolerances'], feature: s.feature, linearMm: s.tolerances.linearMm, maximumOutsideVolumeMm3: s.tolerances.differenceVolumeMm3, maximumRemovedVolumeMm3: s.tolerances.differenceVolumeMm3, connected: true },
  };
  return values[checkId]!;
}
