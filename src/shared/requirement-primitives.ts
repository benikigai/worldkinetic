import { z } from 'zod';

export const CONTRACT_VERSION = 'wk-prototype-0.2' as const;
export const IdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const UnitsSchema = z.literal('mm');
export const CheckIdSchema = z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
export const CheckUnitsSchema = z.array(z.enum(['mm', 'mm2', 'mm3', 'count', 'ratio', 'SHA-256'])).min(1).max(4);
