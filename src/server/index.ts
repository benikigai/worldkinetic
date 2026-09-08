import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { RunStore } from './store.js';
import { createRequirements, type Design } from '../shared/contracts.js';

const port = Number(process.env.PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
const runtimeDir = path.resolve(process.env.WORLDKINETICS_RUNTIME_DIR ?? `.runtime/backend-v2-${port}`);
mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
const lockPath = path.join(runtimeDir, 'instance.lock');
let lock: number;
try { lock = openSync(lockPath, 'wx', 0o600); }
catch { throw new Error(`Runtime directory is locked. Use a separate WORLDKINETICS_RUNTIME_DIR; inspect ${lockPath} before recovering a stopped instance.`); }
writeFileSync(lock, String(process.pid));
process.once('exit', () => { closeSync(lock); unlinkSync(lockPath); });
const requirements = await createRequirements({ designId: 'plate', requirementsVersion: 1, setupId: 'resize_centered_v1', lengthMm: 50 });
const design: Design = { designId: 'plate', label: 'Plate integration reference', units: 'mm', stateVersion: 0,
  referenceId: requirements.referenceId, referenceHash: requirements.referenceHash, setupId: requirements.setupId, setupHash: requirements.setupHash,
  baselineRevisionId: 'baseline_50', activeRequirementsVersion: 1, acceptedRevisionId: null, acceptedRequirementsMatch: false,
  selectedCandidateRevisionId: null, activeRunId: null };
const store = new RunStore(runtimeDir, design, requirements);
const server = createApp(store, runtimeDir);
server.on('error', () => { console.error('Unable to bind the application port. Existing services were preserved.'); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`WorldKinetics backend: http://127.0.0.1:${port}; scope=selected; adapters=unavailable; runtime=${runtimeDir}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => process.exit(0)));
