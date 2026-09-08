import { z } from 'zod';
import { CONTRACT_VERSION, IdSchema } from './requirements-v2.js';

export const PUBLIC_SESSION_COOKIE = '__Host-wk_session';
export const PUBLIC_DEMO_LIMITS = { runsPerSession: 4, runsPerLaunch: 12, sessionsPerLaunch: 20, designsPerSession: 5, sessionHours: 8 } as const;
export const SessionLoginSchema = z.object({ accessCode: z.string().min(1).max(128) }).strict();
export const NewSessionDesignSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requestId: IdSchema, expectedWorkspaceId: IdSchema,
}).strict();
const common = { contractVersion: z.literal(CONTRACT_VERSION), accessMode: z.literal('invite'),
  runsPerSession: z.literal(4), runsPerLaunch: z.literal(12) };
export const SessionStatusSchema = z.discriminatedUnion('authenticated', [
  z.object({ ...common, authenticated: z.literal(false) }).strict(),
  z.object({ ...common, authenticated: z.literal(true), workspaceId: IdSchema,
    runsRemaining: z.number().int().min(0).max(4), launchRunsRemaining: z.number().int().min(0).max(12),
    busy: z.boolean(), expiresAt: z.iso.datetime(), canStartNewDesign: z.boolean(),
  }).strict(),
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type NewSessionDesign = z.infer<typeof NewSessionDesignSchema>;
