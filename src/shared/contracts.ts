import { z } from 'zod';

// Provisional transport only. PLAN owns operation and check semantics.
export const CONTRACT_VERSION = 'wk-backend-draft-0.1' as const;
export const IdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const UnitsSchema = z.literal('mm');
export const ExecutionModeSchema = z.enum(['live', 'fixture', 'unavailable']);
export const ErrorSchema = z.object({
  code: z.string(), message: z.string(), retryable: z.boolean(),
}).strict();
export const RunRequestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  requestId: IdSchema,
  designId: IdSchema,
  inputRevisionId: IdSchema,
  units: UnitsSchema,
  instruction: z.string().trim().min(1).max(2000),
}).strict();
export const OperationSchema = z.object({
  name: z.string().min(1).max(100),
  parameters: z.record(z.string(), z.number().finite()),
}).strict();
export const ArtifactSchema = z.object({
  artifactId: IdSchema, runId: IdSchema, designId: IdSchema, revisionId: IdSchema,
  units: UnitsSchema, kind: z.enum(['editable', 'preview', 'export', 'specification', 'checks']),
  fileName: z.string().min(1), mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  href: z.string().startsWith('/api/artifacts/'), executionMode: ExecutionModeSchema,
}).strict();
export const CheckSchema = z.object({
  checkId: IdSchema, label: z.string(), revisionId: IdSchema,
  state: z.enum(['passed', 'failed', 'not_evaluated']),
  method: z.string().min(1), details: z.string(),
  measuredValue: z.number().finite().nullable(), expected: z.string().nullable(),
  units: z.string().nullable(),
}).strict();
export const RunStatusSchema = z.enum(['queued', 'planning', 'running', 'succeeded', 'failed', 'superseded']);
export const RunSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  runId: IdSchema, requestId: IdSchema, designId: IdSchema,
  inputRevisionId: IdSchema, outputRevisionId: IdSchema, units: UnitsSchema,
  instruction: z.string(), status: RunStatusSchema,
  executionMode: ExecutionModeSchema,
  createdAt: z.string(), updatedAt: z.string(),
  operation: OperationSchema.nullable(),
  checks: z.array(CheckSchema), artifacts: z.array(ArtifactSchema),
  evidenceApplicability: z.enum(['pending', 'current', 'historical', 'unavailable', 'fixture']),
  error: ErrorSchema.nullable(),
  provider: z.object({ name: z.string(), requestedModel: z.string(), reportedModel: z.string().nullable() }).nullable(),
}).strict();
export const EventSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  eventId: z.number().int().positive(), runId: IdSchema,
  designId: IdSchema, revisionId: IdSchema, units: UnitsSchema,
  type: z.enum(['run.accepted', 'run.planning', 'run.running', 'run.completed', 'run.failed', 'run.superseded']),
  createdAt: z.string(), run: RunSchema,
}).strict();
export const DesignSchema = z.object({
  designId: IdSchema, label: z.string(), currentRevisionId: IdSchema,
  latestRunId: IdSchema.nullable(), units: UnitsSchema,
}).strict();
export const BootstrapSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  scopeStatus: z.enum(['not_selected', 'selected']),
  executionMode: ExecutionModeSchema,
  design: DesignSchema.nullable(), runs: z.array(RunSchema),
  unavailableReason: z.string().nullable(),
}).strict();
export type RunRequest = z.infer<typeof RunRequestSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunEvent = z.infer<typeof EventSchema>;
export type Design = z.infer<typeof DesignSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type ApiError = z.infer<typeof ErrorSchema>;

export const ToolErrorCodeSchema = z.enum(['INVALID_OPERATION', 'INVALID_PARAMETERS', 'INPUT_NOT_FOUND', 'INPUT_REVISION_MISMATCH', 'EXPORT_FAILED', 'CHECK_FAILED', 'TOOL_TIMEOUT', 'TOOL_UNAVAILABLE']);
const toolErrors = {
  INVALID_OPERATION: 'The tool does not support this operation.',
  INVALID_PARAMETERS: 'The operation parameters are invalid.',
  INPUT_NOT_FOUND: 'The tool input artifact is unavailable.',
  INPUT_REVISION_MISMATCH: 'The tool input does not match the requested revision.',
  EXPORT_FAILED: 'The tool could not export the revised artifact.',
  CHECK_FAILED: 'The tool could not execute its required checks.',
  TOOL_TIMEOUT: 'The engineering operation exceeded its deadline.',
  TOOL_UNAVAILABLE: 'The engineering runtime is unavailable.',
} as const;
export class ToolExecutionError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: z.infer<typeof ToolErrorCodeSchema>) {
    super(toolErrors[ToolErrorCodeSchema.parse(code)]);
    this.name = 'ToolExecutionError';
    this.retryable = code === 'TOOL_TIMEOUT' || code === 'TOOL_UNAVAILABLE';
  }
}
export interface InputArtifact {
  artifactId: string; revisionId: string; path: string; sha256: string;
  kind: Artifact['kind']; units: 'mm';
}

// TOOLS returns files only from the backend-provided per-run output directory.
export interface ToolInput {
  contractVersion: typeof CONTRACT_VERSION;
  runId: string; designId: string; inputRevisionId: string; outputRevisionId: string;
  units: 'mm'; operation: Operation; outputDir: string; signal: AbortSignal;
  inputArtifacts: InputArtifact[];
}
export const ToolResultSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  runId: IdSchema, designId: IdSchema, inputRevisionId: IdSchema, outputRevisionId: IdSchema,
  units: UnitsSchema, executionMode: z.enum(['live', 'fixture']), operation: OperationSchema,
  checks: z.array(CheckSchema).min(1),
  artifacts: z.array(z.object({
    path: z.string().min(1), kind: ArtifactSchema.shape.kind,
    mediaType: z.string().min(1), fileName: z.string().min(1),
  }).strict()).min(1),
}).strict();
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ToolAdapter = (input: ToolInput) => Promise<ToolResult>;
