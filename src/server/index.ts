import path from 'node:path';
import { createPlateApplication } from './plate-app.js';

const port = Number(process.env.PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
const runtimeDir = path.resolve(process.env.WORLDKINETICS_RUNTIME_DIR ?? `.runtime/backend-v2-${port}`);
const { server, planner } = await createPlateApplication({ runtimeDir, apiKey: process.env.OPENAI_API_KEY });
server.on('error', () => { console.error('Unable to bind the application port. Existing services were preserved.'); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`WorldKinetics backend: http://127.0.0.1:${port}; scope=selected; adapters=${planner ? 'configured' : 'unavailable'}; runtime=${runtimeDir}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => process.exit(0)));
