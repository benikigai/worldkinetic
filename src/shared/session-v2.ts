import { z } from 'zod';
import { CONTRACT_VERSION, IdSchema } from './requirements-v2.js';

export const PUBLIC_SESSION_COOKIE = '__Host-wk_session';
export const PUBLIC_WORKSPACE_HEADER = 'X-WorldKinetics-Workspace';
export const PUBLIC_DEMO_LIMITS = { runsPerSession: 3, runsPerLaunch: 3, sessionsPerLaunch: 20, designsPerSession: 5, sessionHours: 8 } as const;
export const SessionLoginSchema = z.object({ accessCode: z.string().min(1).max(128) }).strict();
export const NewSessionDesignSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), requestId: IdSchema, expectedWorkspaceId: IdSchema,
}).strict();
const common = { contractVersion: z.literal(CONTRACT_VERSION), accessMode: z.literal('invite'),
  runsPerSession: z.number().int().min(1).max(1000), runsPerLaunch: z.number().int().min(1).max(1000) };
export const SessionStatusSchema = z.discriminatedUnion('authenticated', [
  z.object({ ...common, authenticated: z.literal(false) }).strict(),
  z.object({ ...common, authenticated: z.literal(true), accessRole: z.enum(['visitor', 'operator']).optional(), workspaceId: IdSchema,
    runsRemaining: z.number().int().min(0).max(1000), launchRunsRemaining: z.number().int().min(0).max(1000),
    busy: z.boolean(), expiresAt: z.iso.datetime(), canStartNewDesign: z.boolean(),
  }).strict(),
]).superRefine((status, context) => {
  if ((!status.authenticated || status.accessRole !== 'operator') && (status.runsPerSession !== 3 || status.runsPerLaunch !== 3)) {
    context.addIssue({ code: 'custom', message: 'Public visitor limits must remain three runs.' });
  }
  if (status.authenticated && (status.runsRemaining > status.runsPerSession || status.launchRunsRemaining > status.runsPerLaunch)) {
    context.addIssue({ code: 'custom', message: 'Remaining runs cannot exceed the applicable allowance.' });
  }
});
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type NewSessionDesign = z.infer<typeof NewSessionDesignSchema>;
