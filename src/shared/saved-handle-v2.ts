import { z } from 'zod';
import { CONTRACT_VERSION, HashSchema, IdSchema } from './requirements-v2.js';
import { AcceptanceHistorySchema } from './state-v2.js';
import { verifyAcceptanceHistory } from './transport-v2.js';

const file = z.object({ href: z.string().regex(/^\/demo\/handle\/[a-z0-9.-]+$/),
  bytes: z.number().int().positive().max(25 * 1024 * 1024), sha256: HashSchema }).strict();
const revision = z.object({ revisionId: IdSchema, acceptanceId: IdSchema, manifestId: IdSchema }).strict();
export const SavedHandleDemoSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), provenance: z.literal('recorded_product_run'),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), recordedDate: z.literal('2026-09-08'), units: z.literal('mm'),
  initial: revision, refined: revision, history: AcceptanceHistorySchema,
  artifacts: z.array(file.extend({ artifactId: IdSchema })).length(8),
  package: file.extend({ revisionId: IdSchema, acceptanceId: IdSchema, manifestId: IdSchema, manifestHash: HashSchema }),
}).strict();
export type SavedHandleDemo = z.infer<typeof SavedHandleDemoSchema>;

/** Verify recorded evidence without promoting it into a current live workspace. */
export async function verifySavedHandleDemo(value: unknown): Promise<SavedHandleDemo> {
  const demo = SavedHandleDemoSchema.parse(value);
  await verifyAcceptanceHistory(demo.history);
  if (demo.history.acceptances.length !== 2 || demo.history.manifests.length !== 2
    || demo.initial.revisionId === demo.refined.revisionId) throw new Error('Expected two distinct recorded accepted revisions.');
  for (const [stage, ref] of [['initial', demo.initial], ['refined', demo.refined]] as const) {
    const acceptance = demo.history.acceptances.find(a => a.acceptanceId === ref.acceptanceId);
    const manifest = demo.history.manifests.find(m => m.manifestId === ref.manifestId);
    if (!acceptance || !manifest || acceptance.candidate.revisionId !== ref.revisionId || manifest.revisionId !== ref.revisionId
      || manifest.acceptanceId !== ref.acceptanceId || manifest.requirements.setupId !== (stage === 'initial' ? 'handle_initial_v1' : 'handle_refine_v1')) {
      throw new Error('Recorded revision identity mismatch.');
    }
    for (const artifact of manifest.artifacts) {
      const mapped = demo.artifacts.filter(a => a.artifactId === artifact.artifactId);
      if (mapped.length !== 1 || mapped[0]!.sha256 !== artifact.sha256 || mapped[0]!.bytes !== artifact.bytes) throw new Error('Recorded artifact identity mismatch.');
    }
  }
  const refined = demo.history.manifests.find(m => m.manifestId === demo.refined.manifestId)!;
  const initial = demo.history.manifests.find(m => m.manifestId === demo.initial.manifestId)!;
  const baseline = refined.requirements.registryId === 'handle_sample_v1' ? refined.requirements.setup.acceptedInitial : null;
  if (!baseline || baseline.acceptanceId !== demo.initial.acceptanceId || baseline.sha256 !== initial.geometryHash
    || demo.package.revisionId !== refined.revisionId || demo.package.acceptanceId !== refined.acceptanceId
    || demo.package.manifestId !== refined.manifestId || demo.package.manifestHash !== refined.manifestHash
    || new Set([...demo.artifacts.map(a => a.href), demo.package.href]).size !== 9) throw new Error('Recorded package or baseline identity mismatch.');
  return demo;
}
