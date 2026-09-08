# v0.2 contract fixtures

These are **SYNTHETIC conformance fixtures**, not live CAD measurements, executed requests, accepted revisions, or downloadable CAD geometry. Every bootstrap, run, candidate, check and artifact is labeled `fixture`. Both designs have `acceptedRevisionId: null` and `acceptedRequirementsMatch: false`. `reviewable` describes the synthetic check state only; fixture evidence is never eligible for live acceptance.

The server and `src/shared/contracts.ts` now use `wk-prototype-0.2`. The local API implements serialized candidate state, explicit acceptance, confirmed requirements updates, registered artifact delivery and export manifests. The normal server initializes the plate reference and requirements but reports unavailable adapters. Live CAD and Responses API wiring remain unconnected.

## Files

- `reviewable.fixture.json`: centered length 36, synthetic margin 5 mm, all seven checks passed.
- `rejected.fixture.json`: centered length 30, synthetic margin 2 mm against the same minimum 5 mm, margin check failed. The other six synthetic checks pass. Neither case changes the frozen registry.
- `feature-requirements.fixture.json`: frozen feature requirements, nine required checks, fixed attachment and feature regions. No feature candidate or measured geometry is supplied.
- `*.check-bundle.fixture.json`: full hash payload, exact canonical string and SHA-256 for each candidate.
- `registry-hashes.fixture.json`: exact registry file hash, distinct registry semantic hash, and whole canonical registry bytes as a JSON string.
- `canonical-hashes.fixture.json`: valid raw JSON, canonical text, UTF-8 hex and hashes; rejected raw JSON and non-JSON JavaScript cases.
- `synthetic-artifact-bytes.fixture.json`: the synthetic strings used to reproduce artifact descriptor byte counts and hashes. STEP/STL strings are deliberately labeled non-CAD content. The explicit fixture endpoints register these synthetic descriptors for fixture-only downloads.
- Request, event, provider and tool examples below contain concrete fixture identities. Acceptance/export requests are hypothetical payloads, not evidence that those actions occurred.

The approved registry's reference hashes are preserved identities. This task does not rehash or reopen the actual reference CAD files.

## Current public transport

Import released schemas and inferred types from `src/shared/contracts-v2.ts`; acceptance, manifest and history schemas are in `src/shared/state-v2.ts`. `src/shared/contracts.ts` re-exports both. All schema objects are strict. The table documents the current local routes. Fixture responses have no live fallback.

| Surface | Schema and exact example |
| --- | --- |
| `GET /api/bootstrap` | `BootstrapSchema`; `reviewable.fixture.json`, `rejected.fixture.json` |
| `POST /api/runs` | `RunRequestSchema`; `run-request.fixture.json` |
| Run polling | `RunSchema`; each bootstrap's `runs` array. `GET /api/runs/:runId`; `GET /api/runs` returns `{contractVersion,runs}`. |
| Event delivery | `EventSchema`; `event.fixture.json`. `GET /api/runs/:runId/events?after=0` and `GET /api/events?after=0` return `{contractVersion,events}`; polling only, no SSE. |
| `PATCH /api/designs/:designId/requirements` | `RequirementsUpdateRequestSchema`; `requirements-update-request.fixture.json`. Design identity is in the route. |
| `POST /api/revisions/:revisionId/accept` | `AcceptanceRequestSchema`; `acceptance-request.fixture.json`. Route revision must equal `candidateRevisionId`. |
| `POST /api/revisions/:revisionId/export` | `ExportRequestSchema`; `export-request.fixture.json`. The server must resolve and bind revision, acceptance and manifest. |
| `GET /api/acceptances` | `AcceptanceHistorySchema`: `{contractVersion,acceptances,manifests}`. Full persisted acceptance history and matching manifests, including after restart. |
| `GET /api/artifacts/:artifactId` | `ArtifactSchema` descriptors in the bootstrap; immutable registered ID URL. No private path in public descriptors. Downloads include execution and current/historical applicability headers. |

`GET /api/fixtures/bootstrap?state=reviewable|rejected` returns the corresponding frozen bootstrap. `GET /api/fixtures/run` and `/api/fixtures/events` return v2 fixture DTOs. Registered fixture artifact URLs serve the exact labeled synthetic bytes, never CAD geometry.

The exact success envelopes below use `contractVersion: "wk-prototype-0.2"`. Object names denote their schema values, not extra nesting. JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

| Route | HTTP status | Response body |
| --- | --- | --- |
| `GET /api/health` | 200 | `{status:"ok",contractVersion,scopeStatus,providerConfigured,executionMode}` |
| `GET /api/bootstrap` | 200 | `{contractVersion,scopeStatus,executionMode,design,requirements,runs,candidates,unavailableReason}` |
| `POST /api/runs` | 202 first queue; 200 retry | `{contractVersion,reused,run}` |
| `GET /api/runs` | 200 | `{contractVersion,runs}` |
| `GET /api/runs/:runId` | 200 | `RunSchema` directly |
| `GET /api/events`, `GET /api/runs/:runId/events` | 200 | `{contractVersion,events}` |
| `PATCH /api/designs/:designId/requirements` | 200 | `{contractVersion,reused,design,requirements}` |
| `POST /api/revisions/:revisionId/accept` | 200 | `{contractVersion,reused,acceptance,manifest}` |
| `POST /api/revisions/:revisionId/export` | 200 | `{contractVersion,reused,acceptance,manifest}` |
| `GET /api/acceptances` | 200 | `{contractVersion,acceptances,manifests}` |
| `GET /api/candidates/:revisionId` | 200 | `CandidateSchema` directly |
| `GET /api/acceptances/:acceptanceId` | 200 | `AcceptanceSchema` directly |
| `GET /api/manifests/:manifestId` | 200 | `ManifestSchema` directly |
| `GET /api/artifacts/:artifactId` | 200 | Exact registered bytes, not JSON; descriptor MIME type and attachment filename |

History arrays are newest first in acceptance commit order. Join manifests to acceptances by `acceptanceId`, not array position. With no acceptance, the exact response is `{"contractVersion":"wk-prototype-0.2","acceptances":[],"manifests":[]}`. Both arrays come from the same committed store snapshot without an intervening asynchronous operation. Store list getters return deep clones. This route has no pagination, does not create an acceptance or manifest and works with unavailable adapters. Per-ID routes remain available. History contains public artifact descriptors, never runtime filesystem paths.

An acceptance stores the exact request, accepted timestamp/state version, full candidate and requirements. A manifest binds its ID and acceptance ID to design/run/revision, requirements, geometry/source/proposal/check-bundle hashes, engine, checks, change summary, millimeter units and registered artifact descriptors. `manifestHash` hashes canonical JSON of the complete manifest with only `manifestHash` omitted. Packaging references existing checked bytes. Export revalidates the current accepted revision, exact acceptance/manifest and all artifact bytes. A requirements change blocks current export but preserves labeled historical artifact GETs. An old acceptance retry returns its original record without restoring current state.

History reads return immutable records captured at acceptance, even if the corresponding current candidate is later superseded. They do not recheck artifact availability or establish that historical evidence meets today's requirements. Acceptance and export recheck registered byte counts and SHA-256 hashes; artifact GET also verifies the bytes. STEP/source hashes, required checks, editable and STL deliverables, and live provenance remain acceptance gates.

## Errors and retries

Every HTTP error has exactly `{contractVersion,error:{code,message,retryable}}`; no provider output, internal exception or schema diagnostics are returned. For example, a stale CAS returns HTTP 409 with `{"contractVersion":"wk-prototype-0.2","error":{"code":"STATE_CONFLICT","message":"The design state changed. Refresh before retrying.","retryable":false}}`.

| Condition | HTTP status | Public code |
| --- | --- | --- |
| Invalid JSON/UTF-8, duplicate keys, wrong contract, extra fields, invalid cursor | 400 | `INVALID_REQUEST` |
| Unrelated browser origin | 403 | `INVALID_REQUEST` |
| Unknown route or resource ID | 404 | `INVALID_REQUEST` |
| Changed payload or operation for a recorded request ID; route/body identity mismatch | 409 | `IDENTITY_CONFLICT` |
| Stale state/requirements/selected revision or incompatible export identity | 409 | `STATE_CONFLICT` |
| Mismatched, missing, failed, fixture or altered acceptance evidence/bytes | 409 | `EVIDENCE_CONFLICT` |
| Mutation body exceeds 8192 bytes | 413 | `INVALID_REQUEST` |
| Mutation content type is not `application/json` | 415 | `INVALID_REQUEST` |
| New run without configured adapters | 503 | `TOOL_UNAVAILABLE` |
| Unexpected server failure, including unreadable or altered artifact download | 500 | `EXECUTION_FAILED` |

Internal error names such as `INVALID_CURSOR`, `RUN_NOT_FOUND` and `CONTENT_TYPE` normalize to the frozen public `INVALID_REQUEST` code. Use HTTP status to distinguish these cases. The exact safe error values, also used in run/candidate error fields, are:

| Code | Message | retryable |
| --- | --- | --- |
| `INVALID_REQUEST` | The request is invalid. | false |
| `IDENTITY_CONFLICT` | The request identity conflicts with existing data. | false |
| `EVIDENCE_CONFLICT` | The evidence does not match the current requirements. | false |
| `STATE_CONFLICT` | The design state changed. Refresh before retrying. | false |
| `PROVIDER_UNAVAILABLE` | The generation provider is unavailable. | true |
| `TOOL_UNAVAILABLE` | The engineering runtime is unavailable. | true |
| `RUN_TIMEOUT` | The run exceeded its deadline. | true |
| `EXECUTION_FAILED` | The engineering operation failed. | false |
| `CHECK_FAILED` | The required checks could not be completed. | false |
| `EXPORT_FAILED` | The checked export is unavailable. | false |

Request IDs share one persisted namespace across mutations. Reusing an ID requires the same operation and canonical parsed payload, including `userActionId`; export also binds the route revision. A successful retry returns `reused:true`. Run retries return the original run identity with its current status. Requirements retries return the original update's design/requirements snapshot; acceptance retries return the original acceptance/manifest. Neither retry rolls current state back. Export retries still require current applicability and intact registered bytes. A failed mutation does not reserve its request ID.

Acceptance requires an explicit `userActionId`, exact selected candidate and hashes, plus CAS against `expectedStateVersion`, `expectedAcceptedRevisionId` and the active requirements version. Requirements confirmation uses `expectedStateVersion` and `expectedRequirementsVersion`. After a conflict, fetch current bootstrap before deciding on another explicit action; do not silently refresh CAS fields and accept. Generation never autoaccepts. There is no selection endpoint.

## Event cursors and reload recovery

Events are persisted observations, not authoritative state replacements. `eventId` is a positive, globally increasing integer across all runs and design-level events in this runtime. IDs start at 1 and continue after restart; multiple events may share one `stateVersion`. `stateVersion` is the design mutation version, not an event cursor. Events carry optional run/candidate snapshots and an optional acceptance ID, but do not carry full updated design or requirements. In particular, `requirements.updated` has null run/candidate fields. A superseded run's event can identify its older requirements even though the design has newer requirements.

Both event endpoints accept `after`, defaulting to `0`. It must be decimal digits representing a nonnegative safe integer. Responses contain all matching events with `eventId > after` in increasing order. No SSE, pagination, cursor token or high-water field is supplied. An empty response leaves the cursor unchanged; a cursor beyond the latest ID also returns an empty array. Run-filtered events retain their global IDs and can have gaps. Do not advance a global-feed cursor from a run-filtered feed, which omits other runs and design-level updates.

On initial load or reconnect:

1. Fetch `/api/events?after=0` on a fresh load, or use the last processed global event ID when reconnecting to the same persisted runtime. Save the largest returned ID, retaining the prior cursor if empty. Keep these events as observations.
2. Fetch `/api/bootstrap` for authoritative current design, active requirements, runs and candidates. Fetch `/api/acceptances` separately to recover immutable acceptance/manifest history. Bootstrap intentionally has no history arrays or event cursor. Match current acceptance to `design.acceptedRevisionId` and use `acceptedRequirementsMatch` to distinguish current applicability from historical acceptance.
3. Poll `/api/events?after=<saved-global-id>`. Deduplicate by `eventId`. Refresh bootstrap when new events arrive; refresh history for `revision.accepted` or when a bootstrap's accepted revision is missing from local history. Replace current UI state from bootstrap, not old event snapshots or replayed mutation responses. Persist a processed cursor after handling the response.

Reading the event cursor before bootstrap ensures mutations racing with the snapshot fetch remain visible to the next poll. Bootstrap and history are separate requests, so a concurrent mutation may require another refresh to reconcile them. Events already reflected in bootstrap may still arrive; they must not regress displayed state. If an event's `stateVersion` is newer than the loaded design, fetch bootstrap again. With no known saved cursor, reconnect from `0` and deduplicate; never infer a cursor from run count, timestamps or `stateVersion`.

A fresh runtime is a new event sequence. Discard a saved cursor when changing runtime/session; the API has no session token and cannot detect a cursor from a different runtime, so uncertain clients should restart from `0`. No event replay may create acceptance or change selection.

Default startup uses `.runtime/backend-v2-<port>`. A supplied storageVersion 1 runtime throws a new-session error without changing its bytes. Interrupted v2 runs fail once on restart. No legacy automatic promotion is inferred to be human acceptance.

`parsePublicRequest(raw, schema)` caps raw UTF-8 mutation bodies at 8192 bytes, rejects duplicate JSON keys, then parses the selected strict schema. Instructions and change summaries are capped at 2000 characters. HTTP integration must apply the body cap while reading too. Do not apply this small public-request helper to internal tool or evidence responses.

A resize update has exactly `confirmedIntent: { lengthMm }`. The finite length domain is 26 through 200 mm; 30 is allowed and is not clamped to 36. Width 35, base thickness 5, diameter 6, spacing 20 and minimum end material 5 remain frozen. A feature setup update has `confirmedIntent: {}` and selects the entire frozen feature definition. Neither shape permits arbitrary dimensions, thresholds, methods, regions or validator changes. An update requires a distinct explicit `userActionId`; it does not accept a candidate.

Run `completed` is terminal execution state and can contain a `rejected` candidate. Candidate states are `building`, `checking`, `reviewable`, `rejected`, `superseded`, `failed`. Pending/failed records can have null engine/source/geometry/bundle fields and partial checks; reviewable/rejected records require sealed identities, exactly the required checks and matching artifact descriptors. Historical candidates carry their own requirements snapshot. Initially accepted revision is null, and accepted history may later mismatch active requirements.

Only a server serialization boundary can authenticate user actions, allocate immutable IDs, check the current selected revision and versions, enforce CAS/idempotency, and commit acceptance. Parsing an acceptance body is not eligibility verification. Fixture/live provenance, current registered bytes, requirements, engine and validator identities must be checked again there. `safeError(code)` produces fixed public `{code,message,retryable}` text; do not expose provider/tool errors or Zod input diagnostics directly over HTTP.

## Trusted requirements and tools

```ts
const requirements = await createRequirements({
  designId: 'plate', requirementsVersion: 2,
  setupId: 'resize_centered_v1', lengthMm: 36,
  // validatorVersion is optional; only server configuration supplies it.
});
const inputData = await verifyToolInput(serializableInput);
const result = await adapter({ ...inputData, signal: abortController.signal });
const verified = await verifyToolResult(result, inputData);
```

`createRequirements` is an async trusted-server helper, not a provider tool. It derives the requirements ID from design/version/resolved setup hash/validator identity, resolves only sanctioned resize length or the frozen feature setup, and returns the canonical registry/setup strings with SHA-256 identities. Omit `lengthMm` for `tactile_feature_v1`; even an explicit 50 is rejected there. Default validator identity is `plate-validator-v1`; this name defines a binding, not an implemented verifier. Fixture requirements use `fixture_validator_v1` explicitly. Persist these versions immutably. Frontend imports do not grant mutation authority.

`RequirementsSchema.parse` validates structure, frozen semantic definitions and exact canonical strings. SHA-256 checks are asynchronous: use `verifyRequirements`, `verifyToolInput`, `verifyToolResult` and `verifyCandidateEvidence` at trust boundaries. A sync `.parse()` alone does not verify a supplied setup or bundle hash. Do not use provider output to construct or replace requirements.

`ToolInputSchema` is serializable: contract/run/request/design/input revision/output revision/attempt identities; `units`; full `requirements`; exact duplicated `registryCanonicalJson` and `setupCanonicalJson`; `proposal`; private `outputDir`; `deadline` (ISO timestamp) and/or `remainingBudgetMs` (1..180000); private input artifact descriptors. If both time bounds are supplied, TOOLS must use the earlier limit. `ToolInput` adds a local `AbortSignal` after parsing. Passing `signal` through the strict data schema is rejected. `ToolAdapter` is `(input: ToolInput) => Promise<ToolResult>`.

`ProviderProposalSchema` has exactly two strict variants, shown by `provider-proposal.fixture.json` and `provider-python-proposal.fixture.json`:

- `{ kind: 'numeric_operation', operation: { name: 'resize_plate', parameters: { lengthMm } } }`
- `{ kind: 'python_source', source, changeSummary }`

Python source must be nonblank and at most 65536 **UTF-8 bytes**. Numeric tool input/result length must equal the confirmed resize requirements. Extra command, path, environment, threshold or requirements fields are rejected, including inside `operation.parameters`. `changeSummary` is untrusted display text, never a source of permissions, requirements or commands. Python itself is untrusted and can be executed only at the separate TOOLS isolation boundary, never by these utilities or the verifier.

`tool-input.fixture.json` and `tool-result.fixture.json` are **internal-only** examples with deliberately fake `/fixture-private/...` paths. Do not forward them to a browser or provider. Tool results echo all dispatched identities, requirements and the actual proposal; carry source/proposal hashes, engine name/version/image digest, sealed STEP hash, complete checks and private artifact descriptors. `verifyToolResult(result, dispatchedInput)` compares these bindings, checks supplied source bytes for Python proposals and recomputes hashes. TOOLS still has to seal and hash actual generated source for numeric proposals and actual STEP bytes. Server registration must verify output containment, non-symlink files, file sizes/hashes and declared MIME before projecting `ArtifactSchema` descriptors. Serializable data and an AbortSignal do not implement isolation or enforce deadlines.

## Canonical bytes and hashes

`canonicalize(value)` returns JSON with no whitespace or trailing newline. Object keys sort lexicographically by UTF-16 code units, including numeric-looking keys; serialization writes sorted keys directly rather than relying on JavaScript property enumeration. Numbers and strings use ECMAScript `JSON.stringify` encoding: finite IEEE-754 numbers, `-0` becomes `0`, exponent notation follows ECMAScript, strings retain Unicode with JSON escaping and no normalization. UTF-8 encoding uses `TextEncoder`. Numeric input is parsed as JavaScript numbers, not arbitrary-precision decimal; the fixture explicitly demonstrates rounding beyond the safe integer range. Identity/version fields separately require safe integers.

Arrays named `checks` sort by unique `checkId`; arrays named `requiredChecks` sort by unique string ID. Other arrays retain their meaningful order, including coordinates and ranges. Duplicate check IDs, undefined, functions, symbols, bigint, nonfinite numbers, sparse/extended arrays, cycles, accessors and non-plain objects are rejected. Depth is limited to 128. `parseStrictJson(raw)` rejects nested duplicate keys, Unicode-escaped equivalent keys, malformed JSON, trailing data and numeric overflow before any object keys can be lost. JSON object keys such as `__proto__` remain ordinary own data properties.

`sha256(textOrBytes)` hashes exact bytes using browser/Node WebCrypto. TOOLS must hash the supplied immutable canonical strings as UTF-8, not reproduce them using Python serialization. No serializer dependency was added.

- Registry file SHA-256 covers the exact frozen JSON file, including formatting/newline: `d9de0bbe0c6a03f101d5f9562360ac10d0a4216401533eb9be0b4148c8a9aa33`.
- Registry semantic SHA-256 covers the whole canonical registry: `593ece1f1387e766f0e80bdabc45ab6ad46c6301e8d1421f8a05d8a06f657f7d`.
- Setup SHA-256 covers the complete resolved setup: registry/setup identities, dimensions/holes, units/frame/identity transform, reference identities/hashes, protected/keep-out regions, feature thresholds, tolerances, required check IDs and explicitly null process profile.
- `expectedForCheck(requirements, checkId)` derives expected values and immutable field references. Check methods and units must exactly match the frozen registry. Candidate/tool parsing rejects replacement expected thresholds or mismatched evidence identities. These schema comparisons do not execute geometric checks or prove that a tool's measurements are true.
- `checkBundleHashPayload(candidate)` returns the single shared full-record mapping: contract/design/run/request/attempt/revision/input revision, requirements ID/version, registry ID/hash, setup ID/hash, reference hash, validator version, units/mode, engine identity, source/proposal/geometry hashes and every complete check record including expected/measured values and optional diagnostics. `computeCheckBundleHash` hashes its canonical bytes. Status, timestamps, mutable selection, acceptance and the bundle hash itself are excluded. For tool output pass `{ ...result, revisionId: result.outputRevisionId }`.

`geometryHash` means sealed STEP byte hash, not geometric equivalence. `proposalHash` is the full canonical proposal hash; `sourceSha256` is the actual source UTF-8 hash. A changed check, threshold, diagnostic or bound identity changes the bundle hash. Matching hashes do not authenticate an untrusted producer; registration and verifier authority remain server/TOOLS responsibilities.

## Reproduce and migrate

Run `node --import tsx fixtures/api/v2/generate.ts` to regenerate these deterministic synthetic fixtures and validate schema/hash bindings. It reads only the approved public registry, writes only this v2 fixture directory and calls no provider, CAD, network or service. To check the additive release:

```sh
node --import tsx --test tests/backend/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --import tsx scripts/build.ts
```

The server migration preserves v0.1 history by requiring a fresh runtime, migrates owned server/CLI callers and supplies v2 routes for the frontend handoff. Frontend integration and live tool/provider wiring remain separate tasks. Old automatic revision advancement is not proof of prior human acceptance. Live isolated generation/verification, feature feasibility, real exports, browser downloads and physical testing remain outside this schema release.

## Numeric plate application (BACKEND-04)

The product entry point now calls `createPlateApplication` and uses `ResponsesAstraPlanner` with the existing `cadToolAdapter`. It sends one native fetch POST to `https://api.openai.com/v1/responses`, requesting `gpt-6-astra`, with `store: false`, `background: false`, no tools and a strict `text.format` JSON schema capped at 4096 output tokens. The schema fixes `resize_plate` and the exact confirmed length. The request includes the immutable requirements and run intent. Response parsing requires completed assistant text, rejects duplicate JSON keys, extra operations, refusals, tool calls and any other reported model, and caps response bytes at 1 MiB. The [official Responses create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) describes the API fields. Earlier API access proof does not establish this application flow.

Export the server-only `OPENAI_API_KEY` using the operator's existing secret-management workflow before starting. No SDK dependency or browser credential is used. `fetchImpl` and `tool` factory arguments are test seams; no HTTP request can set them. Shell variables must be exported explicitly; `.env.example` is documentation, not an automatically loaded file.

```sh
npm run build
PORT=4314 WORLDKINETICS_RUNTIME_DIR=.runtime/backend-v2-4314 npm start
curl http://127.0.0.1:4314/api/bootstrap
curl http://127.0.0.1:4314/api/reference
```

The server binds loopback only and holds an exclusive `instance.lock` for the runtime. The default directory is `.runtime/backend-v2-<port>`. Use a fresh directory for a new session. A legacy storageVersion 1 snapshot is rejected without replacement. On startup the selected plate has confirmed length 50, `baselineRevisionId: baseline_50` and no accepted revision. Without credentials it remains selected with execution unavailable; a new run returns 503. Configured adapters do not establish provider access or CAD readiness. A missing CAD runtime fails explicitly, with no fixture fallback.

`GET /api/reference` uses the browser-safe schemas in `src/shared/reference-v2.ts`. It returns `{contractVersion, reference}` with the original reference ID `plate_revised_50x35x5`, revision `baseline_50`, units `mm`, provenance `saved_reference`, and STEP/STL descriptors containing only registered artifact ID, filename, MIME, byte count, SHA-256 and download URL. Downloads use `/api/reference/artifacts/<registered-id>` and recheck the stored file's hash and size. The descriptors have no filesystem paths or current run evidence. These are saved reference geometry, never checked candidate output.

Registration reads the actual files under `examples/plate/revised`, verifies canonical hashes, and seals copies under the runtime's `references/baseline_50` without overwrites. Startup and downloads detect tampering. Canonical STEP SHA-256 is `9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3`; STL SHA-256 is `be0f4113c8b12339f37d7a34cbb1b967b22fae6c13bbcabd156a591480dc2d4a`. Execution supplies the sealed STEP as `kind: reference`, `revisionId: baseline_50`; original example files remain intact.

This slice supports numeric resize from the baseline only. Confirm a length through the existing requirements PATCH before submitting a run with that requirements version. A length of 30 remains 30 and may fail checks. The planner cannot clamp it to 36 or change thresholds. After explicit acceptance, new runs report unavailable until a separate schema handoff supports later reference-artifact transport. Accepted input is never relabeled as baseline and no baseline fallback occurs. The frozen feature setup can still be represented but cannot execute through this numeric path.

Provider planning and tool execution share one 180-second deadline and AbortSignal. The executor creates only the output directory's parent; TOOLS creates the output directory. Identical run request retries return the same stored run without another provider or tool call, including after failure. Registered output import, strict tool-result validation, acceptance CAS, exports and history use the existing stack.

Private receipts are written under `<runtime>/runs/<runId>/provider/receipt.json` with actual `responseId`, requested/reported model, sanitized token usage, proposal hash and completion status. Unknown values remain null. Credentials, raw provider bodies and provider error text are not retained. `CodexAstraPlanner` and `npm run verify:astra` remain legacy optional probes and are not the product runtime.

Validation for this slice uses injected Responses and tool implementations:

```sh
node --import tsx --test tests/backend/*.test.ts && node node_modules/typescript/bin/tsc --noEmit && node --import tsx scripts/build.ts
```

Real Responses/CAD integration, container isolation behavior, geometry measurements, browser review, explicit acceptance and downloaded candidate exports still require the parent's integration run. This worker does not perform real API, CAD or Docker execution or restart services.
