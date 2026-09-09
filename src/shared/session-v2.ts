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
  runsPerSession: z.number().int().min(1).max(1000).nullable(), runsPerLaunch: z.number().int().min(1).max(1000).nullable() };
export const SessionStatusSchema = z.discriminatedUnion('authenticated', [
  z.object({ ...common, authenticated: z.literal(false) }).strict(),
  z.object({ ...common, authenticated: z.literal(true), accessRole: z.enum(['visitor', 'operator']).optional(), workspaceId: IdSchema,
    runsRemaining: z.number().int().min(0).max(1000).nullable(), launchRunsRemaining: z.number().int().min(0).max(1000).nullable(),
    busy: z.boolean(), expiresAt: z.iso.datetime(), canStartNewDesign: z.boolean(),
  }).strict(),
]).superRefine((status, context) => {
  const publicUnlimited = status.runsPerSession === null && status.runsPerLaunch === null;
  if ((!status.authenticated || status.accessRole !== 'operator') && !publicUnlimited && (status.runsPerSession !== 3 || status.runsPerLaunch !== 3)) {
    context.addIssue({ code: 'custom', message: 'Public visitor allowance must be three or explicitly unlimited.' });
  }
  if (status.authenticated) {
    const values = [status.runsPerSession, status.runsPerLaunch, status.runsRemaining, status.launchRunsRemaining];
    const unlimited = values.every(value => value === null);
    if (!unlimited && (values.some(value => value === null)
      || status.runsRemaining! > status.runsPerSession! || status.launchRunsRemaining! > status.runsPerLaunch!)) {
      context.addIssue({ code: 'custom', message: 'Allowance must be consistently bounded or explicitly unlimited.' });
    }
  }
});
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type NewSessionDesign = z.infer<typeof NewSessionDesignSchema>;
