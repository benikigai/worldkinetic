import { z } from 'zod';
import { AcceptanceRequestSchema, ArtifactSchema, EngineSchema, CheckSchema, CandidateSchema, CONTRACT_VERSION, HashSchema, IdSchema, RequirementsSchema, StateVersionSchema } from './contracts-v2.js';

export const AcceptanceSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), acceptanceId: IdSchema,
  request: AcceptanceRequestSchema, acceptedAt: z.string().datetime(), stateVersion: StateVersionSchema,
  candidate: CandidateSchema, requirements: RequirementsSchema,
}).strict();
export const ManifestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), manifestId: IdSchema, manifestHash: HashSchema,
  acceptanceId: IdSchema, designId: IdSchema, runId: IdSchema, revisionId: IdSchema,
  requirements: RequirementsSchema, checkBundleHash: HashSchema, geometryHash: HashSchema,
  sourceSha256: HashSchema, proposalHash: HashSchema, engine: EngineSchema.nullable(),
  checks: z.array(CheckSchema), changeSummary: z.string(), units: z.literal('mm'),
  artifacts: z.array(ArtifactSchema),
}).strict();
export type Acceptance = z.infer<typeof AcceptanceSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
