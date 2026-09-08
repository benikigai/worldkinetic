# WorldKinetics

Backend scaffold for a revision-aware edit, check, and export application, serving FRONTEND's static design preview. Product scope is still `NOT_SELECTED`; no CAD tool or product interaction has been integrated.

## Run

Requires Node 22 or newer.

```sh
npm ci
npm run build
npm start
```

The integration server listens at `http://127.0.0.1:4310`. `GET /api/bootstrap` reports actual readiness. `PORT` and `WORLDKINETICS_RUNTIME_DIR` select an isolated instance; the default runtime is `.runtime/backend-4310/`. A runtime lock prevents two servers sharing mutable state. After a crash, verify the PID in `instance.lock` is no longer running before removing only that stale lock.

```sh
npm run typecheck
npm test
```

The frontend owner uses `src/client/`; the four handed-off static assets build to `dist/client/`. The application server serves that build on the same origin. TOOLS owns `src/tools/` and `fixtures/tools/`. BACKEND owns server code, executable schemas, root configuration and manifests. DEMO owns `tests/e2e/`. Use separate worktrees from the published baseline when parallel changes would overlap.

## Provisional transport

Version: `wk-backend-draft-0.1`. PLAN must approve the object, operation, units, parameter constraints, check meaning and export formats before live product execution. TypeScript and executable Zod schemas are in `src/shared/contracts.ts`. Units are provisionally `mm` and require PLAN confirmation.

| Route | Response |
| --- | --- |
| `GET /api/health` | Runtime and configured readiness |
| `GET /api/bootstrap` | Version, scope status, design, runs, unavailable reason |
| `POST /api/runs` | `202 {contractVersion,reused:false,run}`; identical retry `200` with same run |
| `GET /api/runs/:runId` | Full run including evidence applicability |
| `GET /api/runs/:runId/events?after=0` | `{contractVersion,events}`; poll using increasing numeric eventId |
| `GET /api/artifacts/:artifactId` | Bytes from the registered artifact, with revision/execution headers |
| `GET /api/fixtures/run` | Explicit fixture, never current evidence |
| `GET /api/fixtures/events` | Explicit fixture event array |

Example request shape, only after a design is selected:

```json
{
  "contractVersion": "wk-backend-draft-0.1",
  "requestId": "unique-user-request-id",
  "designId": "id-from-bootstrap",
  "inputRevisionId": "current-revision-from-bootstrap",
  "units": "mm",
  "instruction": "The user's requested change"
}
```

Reuse `requestId` only for the exact same request. An intentional new edit needs a new ID and the current input revision. Reusing an ID with different content or using a stale input revision returns `409`. Accepted runs reserve unique output revisions and private tool-output directories. Only the latest applicable run can promote a revision. A failed or timed-out run never promotes output; historical runs retain their own download references.

Errors use `{contractVersion,error:{code,message,retryable}}`. Pending, unavailable and fixture evidence is explicit. `succeeded` means the operation completed, not that every engineering check passed. Check states are independently `passed`, `failed` or `not_evaluated`. Old event snapshots must not replace a newer selected run in the browser.

## TOOLS adapter

Implement the shared `ToolAdapter` signature after PLAN assigns an operation. Receive contract/run/design/input/output revision IDs, `mm`, a validated operation, private `outputDir`, `inputArtifacts` and `AbortSignal`. Input artifacts include private paths, SHA-256, revision and units. The backend resolves prior completed revision artifacts or explicitly registered baseline files; an empty list requires a PLAN-selected built-in parametric reference with an exact known revision, never an invented lookup. Verify source hashes and revisions before edits. Return `ToolResultSchema` with the identical IDs, actual applied operation, live execution, at least one revision-bound check and local file references. All artifacts must be nonempty regular files inside `outputDir`. The backend registers immutable copies and computes download URLs, sizes and SHA-256 hashes. At least one artifact must be editable.

Do not implement application URLs, provider calls or a second CAD stack in the adapter. Raise shared `ToolExecutionError(code)` for known failures and honor cancellation. Its safe message/retryability comes from the shared code map; raw subprocess exceptions are redacted. Fixture data stays under `fixtures/tools/`, uses the same result shape with `executionMode: "fixture"`, and is rejected by the live dispatcher.

## Astra interface

The installed older PATH CLI, 0.144.1, did not complete the verification call. The desktop-bundled CLI 0.153.4 completed a constrained live response through the existing ChatGPT login. This route uses Codex subscription authentication; no event API key was found or used. Keep all provider settings server-side.

```sh
WORLDKINETICS_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex npm run verify:astra
```

The probe uses the actual `CodexAstraPlanner`, requests `gpt-6-astra`, and records validated output and a completed-turn receipt in `.runtime/provider-probes/`. It does not run CAD or enter application history. CLI events do not report the returned model identity, so `reportedModel` remains null. The subprocess ignores user configuration, disables tools, receives a schema-limited parameter task, and uses a read-only sandbox plus private per-run logs. It has no automatic retries. The application deadline kills the process group; only validated output reaches the one allowed tool adapter. Unrelated server environment variables are excluded.

## Known gaps

- PLAN has not selected the object, allowed edit, checks or export formats.
- No live geometry operation or product browser interaction has run. Backend tests use synthetic adapters and do not establish CAD success.
- The Astra probe is verified separately; connecting it to an accepted operation still requires PLAN and TOOLS.
- The fixture download is descriptive JSON, not editable CAD. Fixture check evidence is not evaluated.
- The Node backend is local only at baseline publication. FRONTEND separately deployed a static placeholder; that does not deploy these APIs.
