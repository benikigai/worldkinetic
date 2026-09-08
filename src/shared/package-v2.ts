import { z } from 'zod';
import { ExportRequestSchema } from './contracts-v2.js';

const preference = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]*$/).nullable().optional();
export const PackageRfqSchema = z.object({
  quantity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  material: preference,
  finish: preference,
  destination: preference,
  neededBy: z.iso.date().nullable().optional(),
}).strict();

// Stateless download: requestId correlates the response and never reserves an edit.
export const PackageRequestSchema = ExportRequestSchema.extend({ rfq: PackageRfqSchema.optional() });
export type PackageRequest = z.infer<typeof PackageRequestSchema>;
export type PackageRfq = z.infer<typeof PackageRfqSchema>;
export const PACKAGE_MAX_BYTES = 25 * 1024 * 1024;
export const PACKAGE_HEADERS = {
  contractVersion: 'X-WorldKinetics-Contract-Version',
  requestId: 'X-WorldKinetics-Request',
  revisionId: 'X-WorldKinetics-Revision',
  acceptanceId: 'X-WorldKinetics-Acceptance',
  manifestId: 'X-WorldKinetics-Manifest',
  manifestHash: 'X-WorldKinetics-Manifest-Hash',
  sha256: 'X-WorldKinetics-Package-SHA256',
  applicability: 'X-WorldKinetics-Applicability',
} as const;
