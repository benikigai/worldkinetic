import path from 'node:path';
import { createPlateApplication } from './plate-app.js';
import { createHandleApplication } from './handle-app.js';

const port = Number(process.env.PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
const runtimeDir = path.resolve(process.env.WORLDKINETICS_RUNTIME_DIR ?? `.runtime/backend-v2-${port}`);
const design = process.env.WORLDKINETICS_DESIGN ?? 'plate';
if (!['plate', 'handle'].includes(design)) throw new Error('WORLDKINETICS_DESIGN must be plate or handle.');
const referenceDir = process.env.WORLDKINETICS_HANDLE_REFERENCE_DIR;
if (design === 'handle' && !referenceDir) throw new Error('Handle mode requires WORLDKINETICS_HANDLE_REFERENCE_DIR.');
const { server, planner } = design === 'handle'
  ? await createHandleApplication({ runtimeDir, apiKey: process.env.OPENAI_API_KEY, referenceFiles: {
    stepPath: path.resolve(referenceDir!, 'reference.step'), previewPath: path.resolve(referenceDir!, 'preview.stl'),
    datumPath: path.resolve(referenceDir!, 'datums.json'),
  } })
  : await createPlateApplication({ runtimeDir, apiKey: process.env.OPENAI_API_KEY });
server.on('error', () => { console.error('Unable to bind the application port. Existing services were preserved.'); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`WorldKinetics backend: http://127.0.0.1:${port}; scope=selected; adapters=${planner ? 'configured' : 'unavailable'}; runtime=${runtimeDir}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => process.exit(0)));
