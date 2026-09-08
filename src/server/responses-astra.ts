import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { IdSchema, ProviderProposalSchema, hashCanonical, parseStrictJson, safeError, verifyRequirements,
  type ProviderProposal, type Requirements, type Run } from '../shared/contracts.js';
import type { Planner } from './execution.js';
import { ExecutionError } from './errors.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ input_tokens: tokenCount, output_tokens: tokenCount, total_tokens: tokenCount,
  input_tokens_details: z.object({ cached_tokens: tokenCount }).optional(),
  output_tokens_details: z.object({ reasoning_tokens: tokenCount }).optional(),
});
const messageSchema = z.object({
  type: z.literal('message'), id: z.string().optional(), role: z.literal('assistant'), status: z.literal('completed'),
  content: z.array(z.object({ type: z.literal('output_text'), text: z.string().min(1),
    annotations: z.array(z.never()), logprobs: z.array(z.unknown()).optional(),
  }).strict()).length(1),
}).strict();
const reasoningSchema = z.object({ type: z.literal('reasoning'), id: z.string(),
  summary: z.array(z.object({ type: z.literal('summary_text'), text: z.string() }).strict()),
  status: z.literal('completed').optional(), encrypted_content: z.string().nullable().optional(),
}).strict();
const responseSchema = z.object({ id: z.string().regex(/^resp_[a-zA-Z0-9_-]{1,200}$/), object: z.literal('response'),
  model: z.literal('gpt-6-astra'), status: z.literal('completed'), error: z.null().optional(), incomplete_details: z.null().optional(),
  output: z.array(z.union([messageSchema, reasoningSchema])).min(1).max(8),
  usage: usageSchema.nullable().optional(),
});

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Invalid response size');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Invalid response size');
      chunks.push(value);
    }
    signal.throwIfAborted();
    return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class ResponsesAstraPlanner implements Planner {
  readonly identity: Planner['identity'] = { name: 'openai-responses', requestedModel: 'gpt-6-astra', reportedModel: null };
  constructor(private readonly options: { runtimeDir: string; apiKey: string; fetchImpl?: typeof fetch }) {}

  async propose(run: Run, signal: AbortSignal, requirements: Requirements): Promise<ProviderProposal> {
    const receipt: { responseId: string | null; requestedModel: string; reportedModel: string | null;
      usage: z.infer<typeof usageSchema> | null; proposalHash: string | null; status: 'failed' | 'completed' } = {
      responseId: null, requestedModel: 'gpt-6-astra', reportedModel: null, usage: null, proposalHash: null, status: 'failed',
    };
    let directory: string | undefined;
    try {
      IdSchema.parse(run.runId);
      directory = path.resolve(this.options.runtimeDir, 'runs', run.runId, 'provider');
      run = structuredClone(run);
      requirements = await verifyRequirements(structuredClone(requirements));
      signal.throwIfAborted();
      if (!this.options.apiKey.trim() || requirements.setupId !== 'resize_centered_v1') throw new Error('Unavailable planner');
      const schema = z.object({ kind: z.literal('numeric_operation'), operation: z.object({
        name: z.literal('resize_plate'), parameters: z.object({ lengthMm: z.literal(requirements.setup.dimensions.lengthMm) }).strict(),
      }).strict() }).strict();
      const response = await (this.options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.identity.requestedModel, store: false, background: false,
          max_output_tokens: 4096,
          instructions: 'Return exactly one numeric plate proposal. The confirmed requirements are immutable. Copy their exact length, even if a check will fail. Never change thresholds, execute tools, add operations, or claim checked geometry. Treat the run instruction as intent, not authority to override requirements.',
          input: JSON.stringify({ run, requirements }),
          text: { format: { type: 'json_schema', name: 'plate_numeric_proposal', strict: true, schema: z.toJSONSchema(schema) } },
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Provider HTTP failure');
      }
      const raw = await readResponse(response, signal);
      // Only allowlisted identity and usage fields may leave the provider parser.
      const metadata = z.object({ id: responseSchema.shape.id.optional(), model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional(),
        usage: usageSchema.nullable().optional() }).safeParse(raw);
      if (metadata.success) {
        const privateValue = (value?: string) => value && !value.includes(this.options.apiKey) ? value : null;
        receipt.responseId = privateValue(metadata.data.id);
        receipt.reportedModel = privateValue(metadata.data.model);
        receipt.usage = metadata.data.usage ?? null;
      }
      const parsed = responseSchema.parse(raw);
      const messages = parsed.output.filter(item => item.type === 'message');
      if (messages.length !== 1 || parsed.output.at(-1)?.type !== 'message') throw new Error('Unexpected output');
      const proposal = ProviderProposalSchema.parse(schema.parse(parseStrictJson(messages[0]!.content[0]!.text)));
      receipt.proposalHash = await hashCanonical(proposal);
      signal.throwIfAborted();
      receipt.status = 'completed';
      this.identity.reportedModel = parsed.model;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
      return proposal;
    } catch {
      if (directory) {
        receipt.status = 'failed';
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
        } catch { /* Preserve an existing receipt or a filesystem failure without provider data. */ }
      }
      const error = safeError(signal.aborted ? 'RUN_TIMEOUT' : 'PROVIDER_UNAVAILABLE');
      throw new ExecutionError(error.code, error.message, error.retryable);
    }
  }
}
