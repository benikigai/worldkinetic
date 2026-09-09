import path from 'node:path';
import { createPublicDemo } from './public-demo.js';

const port = Number(process.env.PORT ?? 4330);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid public demo port.');
const reference = process.env.WORLDKINETICS_HANDLE_REFERENCE_DIR;
if (!reference) throw new Error('WORLDKINETICS_HANDLE_REFERENCE_DIR is required.');
const app = await createPublicDemo({
  runtimeDir: path.resolve(process.env.WORLDKINETICS_RUNTIME_DIR ?? `.runtime/public-demo-${port}`),
  publicOrigin: process.env.WORLDKINETICS_PUBLIC_ORIGIN ?? '',
  upstreamKey: process.env.WORLDKINETICS_UPSTREAM_KEY ?? '',
  inviteCode: process.env.WORLDKINETICS_INVITE_CODE ?? '',
  apiKey: process.env.OPENAI_API_KEY,
  operatorCode: process.env.WORLDKINETICS_OPERATOR_CODE,
  operatorRunLimit: process.env.WORLDKINETICS_OPERATOR_RUN_LIMIT === undefined ? undefined : Number(process.env.WORLDKINETICS_OPERATOR_RUN_LIMIT),
  referenceFiles: { stepPath: path.resolve(reference, 'reference.step'), previewPath: path.resolve(reference, 'preview.stl'),
    datumPath: path.resolve(reference, 'datums.json') },
});
app.server.on('error', () => { console.error('Unable to bind the dedicated public demo port.'); void app.close(); process.exitCode = 1; });
app.server.listen(port, '127.0.0.1', () => console.log(`WorldKinetics gated demo listening on loopback port ${port}.`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
