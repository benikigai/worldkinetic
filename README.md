# WorldKinetics

A prototype for adapting products through conversation, editable CAD and independent checks. Built during the September 8, 2026 Astra hackathon.

**Current status:** a tested TypeScript backend scaffold, the original theme preview, and separate verified FreeCAD examples. The application CAD worker, generation/repair loop, user acceptance and API-native steering are not connected yet. The architecture documents describe the next build.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
npm start
```

Open [localhost:4310](http://127.0.0.1:4310). The current page is the design preview. `/api/bootstrap` reports actual readiness; an unavailable CAD adapter is reported explicitly.

```sh
npm run typecheck
npm test
```

The baseline passes type checking, 45 backend tests and the static build. Backend tests use synthetic tool/provider adapters and do not establish a working CAD product.

Use `PORT` and `WORLDKINETICS_RUNTIME_DIR` for separate development instances. Copy `.env.example` as a reference and export the required variables in your shell; the server does not automatically load `.env`. Keep secrets server-side. The optional `npm run verify:astra` probe requires an authenticated compatible Codex CLI and may consume account usage; ordinary tests do not call the live provider.

## Structure

```text
src/client/       Original theme preview; future CAD workspace
src/server/       HTTP, run state, provider adapter, artifact serving
src/shared/       Executable Zod contracts
fixtures/api/     Explicitly labeled scaffold fixtures
scripts/          Build and optional live provider probe
tests/           Backend and end-to-end scaffold checks
examples/plate/   Real FreeCAD models, STEP/STL exports and check evidence
docs/             Architecture, build plan, API notes and provenance
```

Planned tool code belongs in `src/tools/`; it is not implemented at this baseline. See [agent ownership](docs/build-plan.md#roles-and-exclusive-paths) before parallel changes.

## Design and evidence

- [Architecture](docs/architecture.md): generation, independent verification, revisions and Astra experiments.
- [Build plan](docs/build-plan.md): milestones, owners, acceptance criteria and demo sequence.
- [Backend scaffold](docs/backend-scaffold.md): current routes, fixtures, adapter contract and provider limitations.
- [CAD examples](examples/plate/README.md): original and revised plate, exact dimensions and tested exports.
- [Provenance](docs/provenance.md): original work, dependencies and what has actually been verified.

## Known gaps

The public design preview has no CAD interaction. The current numeric planner and automatic revision advancement must be replaced or extended for the proposed review workflow. Isolated generated-code execution, model image feedback, consumer attachment geometry, process-specific checks, public live CAD hosting and physical fit are unverified. The FreeCAD examples demonstrate a separate local experiment.

MIT license for this project's source and owned examples. External dependencies and services retain their own terms.
