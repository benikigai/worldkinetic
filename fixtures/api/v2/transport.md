# v0.2 HTTP transport and acceptance verification

This contract describes `src/server/app.ts` and `src/server/store.ts` at the server `9411ae5` baseline. Shared record definitions remain in `src/shared/contracts-v2.ts` and `src/shared/state-v2.ts`. Import the five strict response schemas and their inferred types directly from `src/shared/transport-v2.ts`. This release adds no routes or runtime behavior.

Every envelope below uses `contractVersion: "wk-prototype-0.2"`. Record names denote direct schema values. JSON responses carry `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

| Method and exact path | Success | Body / request |
| --- | --- | --- |
| `GET /api/health` | 200 | `{status:"ok",contractVersion,scopeStatus,providerConfigured,executionMode}`. Configuration flags do not prove provider or CAD health. |
| `GET /api/bootstrap` | 200 | `BootstrapSchema`: `{contractVersion,scopeStatus,executionMode,design,requirements,runs,candidates,unavailableReason}` |
| `POST /api/runs` | 202 new, 200 reused | `RunRequestSchema` body; `RunMutationResponseSchema`: `{contractVersion,reused,run}` |
| `GET /api/runs` | 200 | `{contractVersion,runs}` |
| `GET /api/runs/:runId` | 200 | `RunSchema` directly |
| `GET /api/events?after=0` | 200 | `EventsResponseSchema`: `{contractVersion,events}` |
| `GET /api/runs/:runId/events?after=0` | 200 | Same events envelope, filtered to this run |
| `PATCH /api/designs/:designId/requirements` | 200 | `RequirementsUpdateRequestSchema` body; `RequirementsMutationResponseSchema`: `{contractVersion,reused,design,requirements}` |
| `POST /api/revisions/:revisionId/accept` | 200 | `AcceptanceRequestSchema` body; `AcceptanceMutationResponseSchema`: `{contractVersion,reused,acceptance,manifest}` |
| `POST /api/revisions/:revisionId/export` | 200 | `ExportRequestSchema` body; same acceptance mutation response envelope |
| `GET /api/acceptances` | 200 | `AcceptanceHistorySchema`: `{contractVersion,acceptances,manifests}` |
| `GET /api/candidates/:revisionId` | 200 | `CandidateSchema` directly |
| `GET /api/acceptances/:acceptanceId` | 200 | `AcceptanceSchema` directly |
| `GET /api/manifests/:manifestId` | 200 | `ManifestSchema` directly |
| `GET /api/artifacts/:artifactId` | 200 | Registered artifact bytes, not a JSON envelope |
| `GET /api/fixtures/bootstrap?state=reviewable` | 200 | Synthetic `BootstrapSchema`; `state` defaults to `reviewable`, also accepts `rejected` |
| `GET /api/fixtures/run` | 200 | Synthetic `RunSchema` directly |
| `GET /api/fixtures/events` | 200 | Synthetic `{contractVersion,events}` |

The synthetic acceptance response file is a conformance artifact, not an HTTP fixture endpoint. There is no selection endpoint, SSE feed or export ZIP endpoint. Export returns the manifest of already checked bytes; downloads use its artifact URLs.

Mutation bodies require `application/json`, strict UTF-8 JSON with no duplicate keys, and at most 8192 bytes. The requirements route must identify the current design; its body has no design ID. Acceptance route revision must equal `candidateRevisionId`. Export resolves the route revision against the supplied acceptance and manifest identities.

## Acceptance response verification

`verifyAcceptanceResponse(value, expectedRequest?)` returns a parsed `AcceptanceMutationResponse` or rejects. `expectedRequest`, when supplied, is the complete original **acceptance** request, including `requestId`, `userActionId`, both CAS fields and every evidence binding. It is not an export request.

The helper composes `verifyRequirements`, `verifyCandidateEvidence`, `canonicalize` and `hashCanonical`. It verifies:

- The stored candidate is reviewable, with complete passed checks and sealed evidence as required by `CandidateSchema`; its requirements and check-bundle hashes verify.
- The acceptance requirements equal the candidate's complete requirements. The request design, candidate revision, requirements version, registry/setup hashes and geometry/check-bundle hashes match that candidate.
- `acceptance.stateVersion === acceptance.request.expectedStateVersion + 1`.
- The manifest references this acceptance and exactly matches its candidate's design, run, revision, requirements, geometry/source/proposal/check-bundle hashes, engine, checks, change summary, units and full artifact descriptors.
- Artifact descriptors sharing a SHA-256 must declare the same byte count, including when source and editable artifacts refer to identical bytes.
- `manifestHash` equals SHA-256 of canonical JSON of the entire manifest with only `manifestHash` omitted.

Canonical comparisons preserve the established set semantics for named `checks` and `requiredChecks` arrays; other arrays, including artifacts, retain order. Structural `.parse()` alone does not perform these asynchronous hash and join checks. Source and proposal identities are bound through the check bundle and manifest; this response contains no proposal/source bytes from which to independently recompute those identities. Artifact bytes require a separate download and byte-count/SHA-256 verification.

`verifyAcceptanceHistory(value)` returns the complete parsed `AcceptanceHistory` with both input array orders preserved. It requires unique acceptance, acceptance-request and manifest IDs, unique acceptance state versions, exactly one manifest per acceptance, and no orphan manifests. It verifies every pair and checks the single-design previous-acceptance chain in state-version order on a copy. The first record in commit order must expect no prior acceptance. It does not deduplicate by revision ID: accepting the same revision later produces a distinct record that must remain in history.

These helpers validate internal consistency. They do not authenticate a user action or evidence producer, prove freshness or artifact availability, or grant live acceptance/export eligibility. Browser use relies on the existing WebCrypto helpers with no Node-only imports.

## Current state, history and export

Bootstrap is authoritative for current design state and active requirements. Events are observations. Acceptance/history records are immutable snapshots of the evidence at acceptance; a current candidate can later be superseded without rewriting those records.

`GET /api/acceptances` returns full persisted history, normally newest first in acceptance commit order, with manifests joined by `acceptanceId`, never array position. It works without configured adapters and has no pagination. Empty history is exactly `{"contractVersion":"wk-prototype-0.2","acceptances":[],"manifests":[]}`. Both arrays are read synchronously from the same store snapshot.

Determine the latest acceptance **overall** by the highest `acceptance.stateVersion`, then require its candidate revision to match `design.acceptedRevisionId`. Never filter history to the design's accepted revision first and choose an older matching acceptance. A newer acceptance can target the same revision with identical geometry/check hashes but a new acceptance ID, manifest ID/hash and state version.

The latest acceptance version must not exceed `design.stateVersion`; it may be lower after other design mutations. Equal versions are not required for applicability. If bootstrap says no accepted revision, history must be empty for the same snapshot. If it names an accepted revision, history must contain the latest record matching that revision and design.

Enable current export only when all of the following hold:

- A verified latest acceptance/manifest pair matches the current design as above.
- `design.acceptedRequirementsMatch` is true, and the active requirements are verified and exactly equal to the acceptance/candidate/manifest requirements. Bind the active requirements to design ID, active requirements version, setup ID/hash, reference ID/hash and units; checking only the version or setup hash is insufficient.
- Evidence is live, the engine is not a fixture, and all artifact execution modes are live. A structurally valid synthetic pair is ineligible.

Bootstrap and history are independent GET snapshots and can race. On mismatched identity, version or active requirements, refetch **both** and keep current export disabled until they reconcile. Do not choose an older matching acceptance or silently rewrite an acceptance request's CAS fields. Even matching hashes and revision IDs do not establish freshness when a newer acceptance targets the same revision; there is no combined snapshot token here. `POST /api/revisions/:revisionId/export` is the final server gate: it revalidates the latest acceptance record, exact manifest identity/hash, current applicability and registered artifact bytes, including on a retry. A conflict requires refreshed state and a new deliberate decision.

An export response still contains the historical acceptance request. Compare its acceptance ID, manifest ID/hash and revision against the export request/route separately. `expectedRequest` on the acceptance verifier is only for the original acceptance action. Successful JSON verification alone must not enable downloads labeled current.

## Event cursors and recovery

`after` defaults to `0` and must be decimal digits representing a nonnegative safe integer. Events have globally increasing positive `eventId`s across runs and design-level events in one persisted runtime. They survive its restart. Responses contain all matching events with `eventId > after` in increasing order. There is no high-water field, pagination or runtime epoch token. Multiple events can share a design `stateVersion`; it is not an event cursor.

On initial load, uncertain runtime identity, or uncertain reconnect, start the **global** cursor at `0`. Reuse a cursor only when the same persisted runtime is known. A cursor beyond a reset runtime's latest event returns an empty array, so emptiness cannot prove continuity. Never advance the global cursor from a run-filtered feed; those IDs can have gaps and omit design-level events.

Read global events, deduplicate by `eventId`, and retain the largest processed global ID; an empty response leaves that cursor unchanged. Then refresh `/api/bootstrap` **and** `/api/acceptances`. Repeat both refreshes after new events and every reconnect, reconcile races as above, and continue polling from the saved global cursor. Polling from before the snapshot reads lets subsequent polling catch mutations racing those reads.

Do not apply event snapshots as current design state. Events can carry older run/candidate requirements, and `requirements.updated` carries no full design/requirements snapshot. `revision.accepted` supplies an acceptance ID, not a full verified acceptance response. A reconnect must reconcile any pending action before retrying it.

## Errors and idempotency

`ApiErrorResponseSchema` is exactly `{contractVersion,error:{code,message,retryable}}`. Internal exception text and schema diagnostics are not returned. The fixed public values from `safeError` are:

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

| HTTP status | Condition and public code |
| --- | --- |
| 400 | Invalid JSON/UTF-8, duplicate keys, schema/version/extra-field failure or cursor: `INVALID_REQUEST` |
| 403 | Unrelated browser Origin: `INVALID_REQUEST` |
| 404 | Unknown route, run, resource or artifact: `INVALID_REQUEST` |
| 409 | Reused request ID with different payload/operation, or explicit route/body identity conflict: `IDENTITY_CONFLICT` |
| 409 | Stale CAS/selection/requirements, incompatible export identity: `STATE_CONFLICT` |
| 409 | Missing, mismatched, failed, fixture or altered acceptance evidence/bytes: `EVIDENCE_CONFLICT` |
| 413 | Body exceeds 8192 bytes: `INVALID_REQUEST` |
| 415 | Wrong mutation content type: `INVALID_REQUEST` |
| 503 | New run without configured adapters: `TOOL_UNAVAILABLE` |
| 500 | Unexpected failure, including unreadable/altered artifact download: `EXECUTION_FAILED` |

Internal names such as `RUN_NOT_FOUND`, `INVALID_CURSOR`, `CONTENT_TYPE` and `ORIGIN_REJECTED` normalize to `INVALID_REQUEST`; HTTP status distinguishes them. Provider/check errors may also appear on run/candidate records, rather than as an HTTP error from the original enqueue request.

Mutation request IDs share one persisted namespace. Reuse requires the same operation and canonical parsed payload, including `userActionId` where present; export also binds its route revision. Successful retry returns `reused:true`. Runs retain original identity with current status. Requirements and acceptance retries return original snapshots without restoring current state. Export retries still revalidate current applicability and bytes. Failed mutations do not reserve a request ID. New acceptance requires the exact selected candidate and explicit action with `expectedStateVersion` and `expectedAcceptedRevisionId`; requirements confirmation uses `expectedStateVersion` and `expectedRequirementsVersion`. Generation never autoaccepts.

## Artifact headers and synthetic limits

Artifact GET serves registered bytes with these headers from the actual app:

| Header | Value |
| --- | --- |
| `Content-Type` | Descriptor `mediaType` |
| `Content-Length` | Actual response byte length |
| `Content-Disposition` | `attachment; filename="<fileName>"` |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `no-store` |
| `X-WorldKinetics-Revision` | Descriptor `revisionId` |
| `X-WorldKinetics-Execution` | Descriptor `executionMode` |
| `X-WorldKinetics-Applicability` | `fixture` for fixture artifacts; otherwise `current` only when the design accepted revision equals the artifact revision and `acceptedRequirementsMatch` is true; otherwise `historical` |

Applicability headers do not identify the latest acceptance ID or authenticate evidence. Historical artifact GETs remain available without making them current exports. Live artifact reads validate registered byte count/hash; fixture routes serve the existing labeled synthetic strings.

`acceptance-response.fixture.json` embeds the exact candidate from `reviewable.fixture.json` and the hypothetical `acceptance-request.fixture.json`, with synthetic acceptance/action/manifest identities. Its acceptance state version is 12. All existing execution modes remain `fixture`, including checks and artifacts. Its actual canonical manifest hash is `cfaa7b2470f5a674dc21feeb61c212300b3a5f71abf8a67d2852b3ae7df1b84d`. The server rejects fixture evidence for live acceptance and export. This positive fixture proves only schema, hash and join conformance, not an executed acceptance, live CAD, authenticated action, physical fit, strength, printing or manufacturing readiness.

Run the supplied checks with `node --import tsx --test tests/backend/*.test.ts && node node_modules/typescript/bin/tsc --noEmit && node --import tsx scripts/build.ts`. Parent review, wrapper evidence and integration remain separate.
