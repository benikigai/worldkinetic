import { z } from 'zod';
import { HANDLE_DATUM_SHA256 } from './requirements-handle-v2.js';

// Saved reference geometry has no run, check bundle, or acceptance identity.
export const ReferenceArtifactSchema = z.object({
  artifactId: z.string().regex(/^reference_[a-zA-Z0-9_-]+$/).max(100),
  fileName: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
  mediaType: z.enum(['model/step', 'model/stl', 'application/json']),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  href: z.string().regex(/^\/api\/reference\/artifacts\/reference_[a-zA-Z0-9_-]+$/),
}).strict().refine(a => a.href === `/api/reference/artifacts/${a.artifactId}`, 'Reference URL identity mismatch');
export const PlateReferenceSchema = z.object({
  referenceId: z.literal('plate_revised_50x35x5'), revisionId: z.literal('baseline_50'),
  units: z.literal('mm'), provenance: z.literal('saved_reference'),
  artifacts: z.array(ReferenceArtifactSchema).length(2),
}).strict().refine(r => new Set(r.artifacts.map(a => a.artifactId)).size === 2
  && r.artifacts.some(a => a.mediaType === 'model/step')
  && r.artifacts.some(a => a.mediaType === 'model/stl'), 'Reference artifacts must include distinct STEP and STL');
export const HandleReferenceSchema = z.object({
  referenceId: z.literal('handle_mount_v1'), revisionId: z.literal('handle_mount_reference_v1'),
  units: z.literal('mm'), provenance: z.literal('trusted_mount_reference'),
  datumSpecSha256: z.literal(HANDLE_DATUM_SHA256),
  artifacts: z.array(ReferenceArtifactSchema).length(3),
}).strict().refine(r => new Set(r.artifacts.map(a => a.artifactId)).size === 3
  && new Set(r.artifacts.map(a => a.mediaType)).size === 3
  && r.artifacts.some(a => a.mediaType === 'application/json' && a.sha256 === HANDLE_DATUM_SHA256),
  'Handle reference artifacts must include distinct STEP, STL and the fixed datum JSON');
export const ReferenceSchema = z.union([PlateReferenceSchema, HandleReferenceSchema]);
export const ReferenceResponseSchema = z.object({ contractVersion: z.literal('wk-prototype-0.2'), reference: ReferenceSchema }).strict();
export type ReferenceArtifact = z.infer<typeof ReferenceArtifactSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
