import { z } from 'zod';

// Saved reference geometry has no run, check bundle, or acceptance identity.
export const ReferenceArtifactSchema = z.object({
  artifactId: z.string().regex(/^reference_[a-zA-Z0-9_-]+$/).max(100),
  fileName: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
  mediaType: z.enum(['model/step', 'model/stl']),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  href: z.string().regex(/^\/api\/reference\/artifacts\/reference_[a-zA-Z0-9_-]+$/),
}).strict().refine(a => a.href === `/api/reference/artifacts/${a.artifactId}`, 'Reference URL identity mismatch');
export const ReferenceSchema = z.object({
  referenceId: z.literal('plate_revised_50x35x5'), revisionId: z.literal('baseline_50'),
  units: z.literal('mm'), provenance: z.literal('saved_reference'),
  artifacts: z.array(ReferenceArtifactSchema).length(2),
}).strict().refine(r => new Set(r.artifacts.map(a => a.artifactId)).size === 2
  && new Set(r.artifacts.map(a => a.mediaType)).size === 2, 'Reference artifacts must include distinct STEP and STL');
export const ReferenceResponseSchema = z.object({ contractVersion: z.literal('wk-prototype-0.2'), reference: ReferenceSchema }).strict();
export type ReferenceArtifact = z.infer<typeof ReferenceArtifactSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
