# v0.2 contract acceptance case map

The original case map below is preserved for its cited releases. Its references to a v0.1 server and pending state migration are historical. The additive [DEMO-02-STATE software evidence](#demo-02-state-software-evidence) section covers the adopted state/HTTP release separately; it does not upgrade any earlier full integrated case to passed.

This map covers the additive shared-contract release `23a8360` and protected test-quality bootstrap `2832e59`. The executable suite is [contracts-v2.acceptance.test.mjs](../../tests/e2e/contracts-v2.acceptance.test.mjs). It imports the released TypeScript helpers and uses public synthetic fixtures. It makes no HTTP, provider or CAD calls, executes no proposal Python, starts no services or containers and adds no dependencies.

The current server remains v0.1. v0.2 HTTP, state serialization, acceptance, artifact registration and authenticated actions are not established by these tests. A structurally reviewable fixture is still fixture evidence and is ineligible for live acceptance. The fixtures start with no accepted revision. A completed tool/run can contain rejected checks; completion is not acceptance.

Live acceptance: **NOT_ESTABLISHED**. Integrated recording: **NOT_ESTABLISHED**. Physical fit, fabrication and physical testing: **NOT_ESTABLISHED**.

## Automated shared-contract coverage

Run results belong to the actual TAP output and protected runner report, not to this case specification. Every bracketed ID below has a top-level executable test with no skips or todos.

| Cases | Exercised behavior | Limit |
| --- | --- | --- |
| `VALID_FIXTURE` | Reviewable and rejected bootstraps, feature requirements, event/request/proposal shapes, tool integrity; accepted revision stays null | Synthetic conformance only |
| `MISSING_REQUIRED`, `EMPTY_CHECKS`, `DUPLICATE_CHECK`, `UNKNOWN_CHECK` | Delete each required check; empty arrays; duplicate each check by append/replacement; unknown and registered out-of-setup checks | Structural `CandidateSchema` rejection |
| `FAILED_CHECK`, `NOT_EVALUATED` | Every required position blocks reviewability when failed or unevaluated; rejected evidence remains structurally valid | No engineering measurement is performed |
| `CHECK_BINDINGS` | Each check binds requirements ID/version, registry ID/hash, setup ID/hash, reference hash, validator version, revision, geometry hash and execution mode; method, units and expected values are frozen | Registry ID is a literal shape constraint; other identity mismatches use individually valid records |
| `ARTIFACT_BINDINGS` | Each artifact binds requirements ID/version, registry ID/hash, setup ID/hash, reference hash, validator version, run/design/revision and mode; required STEP/source hashes, editable/STL presence and unique artifact IDs | Does not authenticate registered files |
| `STALE_BUNDLE` | Structurally valid changed details, measurement, engine version/digest, proposal hash or bundle hash fail `verifyCandidateEvidence`; published bundles and reordered check sets verify | Hash identity is not proof of accurate measurement |
| `REQUIREMENTS_HASH` | Well-formed wrong setup hash passes structure but fails `verifyRequirements` | Trust boundary must call the async helper |
| `DISPATCH_BINDINGS` | `verifyToolResult(result, dispatchedInput)` rejects independent run, request, input revision, output revision, attempt, design, requirements version, validator and proposal changes | No scheduler, replay ledger or request serialization |
| `FIXTURE_PROVENANCE` | Fixture engine consistently relabeled live across candidate/checks/artifacts fails structurally | Live eligibility must independently check trusted provenance at acceptance |
| `ACCEPT_ACTION` | Explicit user action, request/evidence identities and CAS fields are mandatory; invalid state versions fail | Does not authenticate the action, compare live versions or commit acceptance |
| `EXPLICIT_REQUIREMENTS` | Explicit update/CAS shape; length 30 remains 30; candidate thresholds, methods, dimensions and extra fields rejected; fixed feature update has empty intent | Does not perform a user-confirmed update |
| `CANONICAL_BYTES`, `DUPLICATE_JSON` | Published UTF-8 text/hex/hashes checked with independent Node SHA-256; raw and Unicode-escaped duplicate keys, nonfinite/non-JSON values rejected; coordinate order retained; check sets sorted | No raw runtime artifact verification |
| `MULTIBYTE_SOURCE` | Exact 65536-byte source boundary and multibyte overflow below the JavaScript character limit | Python is never executed |
| `FEATURE_SETUP` | Fixed 50 x 35 x 5 base, added height 2, total height 7; frozen box, spans, protected regions and both full-extent bores; caller mutations rejected; explicit feature length 50 rejected by both helpers | Requirement semantics only, no feature geometry exists in the fixture |
| `EXPORT_DESCRIPTOR` | Registered ID URL equality; extra private fields rejected; synthetic artifact byte counts/hashes reproduced; export acceptance/manifest fields required | Synthetic STEP/STL strings are not usable CAD or downloads |
| `TOOL_DEADLINE` | Deadline and/or bounded budget, canonical text, distinct revisions, input artifact identity and matching numeric proposal required | Shape does not enforce elapsed time, cancellation or isolation |
| Additional tests | Failed/unavailable tool evidence; independent proposal/source/bundle integrity; public request byte cap and strict Python proposal fields | Error evidence is not successful CAD |

The protected [verify-invariant-tests.mjs](../../tests/e2e/verify-invariant-tests.mjs) checks 13 guard-removal mutations in disposable copies. It requires healthy controls to remain valid, baseline success, all 21 required labels, no skips/todos/cancellations, and a failing assertion under the designated label for each mutation. Successful detection establishes sensitivity to those 13 defects only. It does not establish complete test coverage, live acceptance, geometry correctness or isolation. The runner records a suite fingerprint and per-copy TAP/control logs with its mutation report. Its bootstrap was acceptance setup outside this worker; the parent owns wrapper execution receipts.

## Integrated, state, geometry and browser cases

Every case below is **NOT_RUN** against an integrated v0.2 runtime. These are required evidence targets, not invented enabled endpoints. Use the released transport once BACKEND migrates it. No application mock or parsing assertion may be substituted for the stated observable evidence. Only the final native steering/image flow is optional.

| Case | Input or controlled fault | Required observation and evidence | Status |
| --- | --- | --- | --- |
| Success and explicit acceptance | Clean design, confirmed centered length 36, real generation/checks, then explicit acceptance | Passing exact required set with actual margin 5 mm; candidate selection changes before acceptance while accepted history stays unchanged; authenticated action atomically binds revision, requirements, bundle, state and registered artifacts; capture before/after state and action identity | NOT_RUN |
| Measured conflict and repair | Confirm length 30, then request and confirm correction to 36 | Preserve requested 30 without clamping; independent end margins 2 mm fail fixed minimum 5; failed candidate remains inspectable; regenerated/rechecked 36 produces actual 5 mm margins and needs new explicit acceptance | NOT_RUN |
| Missing/empty checks | Remove one required check in each position, then remove all | Live boundary rejects review/acceptance; accepted state unchanged; record exact missing IDs and response | NOT_RUN |
| Duplicate/unknown checks | Duplicate each required ID; supply unknown or another setup's ID | Reject ambiguous or out-of-setup evidence without deduping into a pass; preserve required set and accepted state | NOT_RUN |
| Check identity mismatch matrix | Change requirements ID/version, registry ID/hash, setup ID/hash, reference hash, validator, revision, geometry hash or mode separately | Each mismatch independently blocks acceptance using current trusted identities, not merely internally consistent submitted data | NOT_RUN |
| Artifact identity mismatch matrix | Change run/design/revision, requirements ID/version, registry ID/hash, setup ID/hash, reference hash, validator or mode separately | Each mismatch fails registration or acceptance; no cross-candidate files served | NOT_RUN |
| Dispatch identity mismatch matrix | Deliver result from another run, request, input/output revision, attempt, design, requirement snapshot or proposal | No result adoption or promotion; retain safe conflict evidence under original identities | NOT_RUN |
| Other sealed identity mismatches | Change source/proposal hash, engine version/image digest, bundle contents/hash, registry/setup bytes or registered geometry bytes | Recompute all relevant hashes and resolve trusted engine/validator identity; block stale or substituted evidence, even if structurally valid | NOT_RUN |
| Accept/update race, acceptance first | Pause concurrent actions with the same expected state; serialize acceptance before requirement update | One valid acceptance records old requirements; stale update conflicts; explicit refreshed update may succeed while preserving accepted history and marking it mismatched; retain both ordered outcomes | NOT_RUN |
| Accept/update race, update first | Serialize requirement update before acceptance of old candidate | Update increments requirements/state; old acceptance conflicts and cannot accept/promote obsolete evidence; retain exact versions and ordering | NOT_RUN |
| Concurrent distinct requests | Submit two requests against the same starting design and expected state | Deterministic serialization/conflict behavior under the released policy, no mixed attempts or artifacts; accepted revision changes only by explicit successful action | NOT_RUN |
| Duplicate/replayed requests | Repeat identical request/action IDs; reuse IDs with changed bodies; retry after lost response | Idempotent replay returns original identity/result without extra generation or acceptance; conflicting reuse rejected; old retry never attaches to a new revision | NOT_RUN |
| Late completion | Change requirements while a job is pending, then deliver its old result | Historical/superseded result remains tied to original requirement version; cannot replace current selection or accepted revision; event order retained | NOT_RUN |
| Failed/unevaluated/unavailable states | Fail a check, make a required measurement unavailable, then disable provider/tool | No review/acceptance; explicit safe failure/unavailable text and inspectable evidence; no synthetic fallback; browser distinguishes these states from pending work | NOT_RUN |
| Export byte identity | Download registered STEP/STL/source plus accepted manifest; substitute same-size or equal-volume different bytes | Download hashes, sizes, units and acceptance/manifest identities match checked sealed revision; substitutions fail; exporter byte changes require resealing and revalidation | NOT_RUN |
| Independent STEP/STL reopening | Open delivered STEP and STL in trusted independent readers | STEP valid single solid, bounds/holes and symmetric difference <= 0.01 mm3, relative volume error <= 0.00001; STL finite, connected, watertight, consistently oriented, positive volume, relative error <= 0.001; dimensions within 0.01 mm and units mm; retain measured reports | NOT_RUN |
| Timeout/partial files | Expire generator/verifier/render deadline or budget during partial output | Stop work/process groups; retain safe timeout; partial or symlink/unexpected outputs never register, export or become reviewable; next fresh job succeeds without leftovers | NOT_RUN |
| Original preservation | Hash original 40 x 30 x 8 source/native/CAD and canonical 50 x 35 x 5 integration reference before edits | All original/reference bytes unchanged after success, rejection, timeout, acceptance and export; both remain accessible separately | NOT_RUN |
| Fixture isolation | Try fixture candidate/check/artifact evidence at the live acceptance boundary, including consistent relabeling | Reject based on trusted provenance; UI labels fixture state; real tool failure cannot silently substitute fixture output | NOT_RUN |
| Fresh reset and restart | Complete two clean sessions and restart between runs, including a pending/failed attempt | New IDs and isolated files; immutable accepted history restored correctly where applicable; no stale selection, mixed requirements or cached fixture output; capture exact reset/restart behavior | NOT_RUN |
| Fixed base versus feature height | Generate new feature in fixed setup, then negative candidates with altered base or wrong total height | Base cross-sections remain 5 mm, added Z span 2 mm, total 7 mm; footprint 50 x 35; fixed centers retained; do not call 7 mm the base thickness | NOT_RUN |
| Feature box and material | Generate connected addition and negative cases outside box, removing baseline material or violating spans | Added box [20,30] x [25,30] x [5,7]; X span 8..10, Y 3..5, Z 2; added volume > 1 mm3; outside/removed material <= 0.01 mm3; protected radius-4 cylinders z=0..5 preserved | NOT_RUN |
| Both full-extent bores | Plug/cap either bore separately, including material above z=5 | Both diameter-6 bores at (15,17.5), (35,17.5), spacing 20 remain unobstructed over full candidate Z extent in STEP and STL; no base-only measurement or volume allowance masks a cap | NOT_RUN |
| Separate isolated source regeneration | Regenerate delivered source in a fresh isolated generator, terminate it, seal output, then compare in a fresh trusted verifier | Source never runs with verifier authority; reproduced geometry matches checked STEP under frozen tolerances; unavailable regeneration is not_evaluated and blocks acceptance; record actual native history where relevant | NOT_RUN |
| Isolation boundary | Attempt host sentinel access, reference writes, network access, lingering background work and deadline overrun in dedicated jobs | Restrictions enforced with no credentials or shared-session mutation; valid job still succeeds; retain boundary results and engine image identity | NOT_RUN |
| Browser state and downloads | Observe pending, rejected, superseded, reviewable and accepted revisions with real geometry | Selected versus accepted states distinct; before/after and highlights match current measured revision; actual downloads reopen; no fixture or canned progress substitutions | NOT_RUN |
| Rehearsal and recording | Repeat clean successful and failure/repair sequence and capture demonstrated revision | Record timings, attempts, artifact hashes, build and engine identity; footage reflects actual run and any editing/speedup; live acceptance and recording remain NOT_ESTABLISHED until reviewed | NOT_RUN |
| Optional native steering/image flow | If supported, steer while pending and return actual rendered views to model | Record acknowledgement/application/disconnect separately, bind late output to original request, use real matching images and feedback; disclose unsupported capability | NOT_RUN |

Physical performance cannot be inferred from any software case above. No print, fabrication, supplier upload or physical test was performed for this deliverable.

## DEMO-02-STATE software evidence

This bounded suite targets the adopted BACKEND release `9411ae57776fd45d3824a25d015b69e7f75adc7c` through actual `RunStore`, artifact registration and `createApp` behavior. [state-http.acceptance.test.mjs](../../tests/e2e/state-http.acceptance.test.mjs) uses temporary runtimes and ephemeral loopback HTTP servers. Preparation through the store injects generation: sealed artifact bytes, engine metadata and all measured fields are synthetic/no CAD. The required `live` enum exercises software eligibility only. No provider, CAD, Docker, browser, shell generation or generated source is executed.

| Evidence tier | What it establishes | Boundary |
| --- | --- | --- |
| Earlier contract helpers | Shared schemas, canonical bytes and hash binding using synthetic fixtures | No HTTP/state or geometry execution |
| DEMO-02-STATE HTTP/state tests | Actual software responses, persisted transitions, exact registered synthetic downloads and conflict behavior | Generation and measurements injected through the store; no HTTP-to-CAD run |
| Owner-reported CAD checks | Separate capability observations recorded in the existing [provenance snapshot](../provenance.md#evidence-snapshot) | Not rerun or independently revalidated by this worker; not integrated acceptance |
| Full live provider/CAD/browser, usable CAD download, physical and rehearsal cases | Still **NOT_RUN** by this suite | Live product acceptance and integrated recording remain **NOT_ESTABLISHED** |

Each ID below is a named top-level `node:test` case. Results belong to the actual TAP output and protected runner report for the tested revision; this table specifies coverage without replacing those receipts.

| ID | Software observation |
| --- | --- |
| `HTTP_FLOW` | Explicit acceptance binds the exact request, requirements, checks, hashes and manifest; all six synthetic artifacts download with exact bytes, SHA-256, length, MIME, disposition, no-store, nosniff, revision, mode and applicability headers |
| `NO_AUTO_ACCEPT` | Completed reviewable work selects a candidate but does not create acceptance; later completion preserves the earlier accepted revision |
| `ACCEPT_SELECTION` | An older reviewable candidate fails with 409 `STATE_CONFLICT` despite a fresh state version; selected candidate succeeds |
| `ACCEPT_STATE_CAS` | Stale state and wrong prior accepted revision conflict; simultaneous distinct acceptance actions produce one success and one 409 |
| `REQUIREMENTS_CAS` | Both expected versions enforced; conflicting confirmed updates cannot both commit; both ordered store acceptance/update races and simultaneous HTTP actions preserve the winning state and history |
| `IDEMPOTENT_PAYLOAD` | Reordered canonical payloads reuse run/acceptance/requirements/export identities; changed payloads and cross-operation ID reuse return 409 `IDENTITY_CONFLICT`; retries after later state and restart do not roll it back |
| `HISTORY_RELOAD` | Multiple acceptance records and matching manifests remain newest-first through HTTP and store getters after restart, with individual historical records readable |
| `HISTORY_CLONE` | Mutating nested list/get results cannot change stored history or subsequent HTTP responses, including after restart |
| `EVENT_CURSOR` | Strictly increasing event IDs, exclusive cursors, empty repeated polling, run filtering and restart allow deduplicated replay; malformed cursors return 400 |
| `EXPORT_RETRY_RECHECK` | Fresh and same-ID export retries fail 409 after requirement changes, including after restart; accepted history and historical downloads remain readable; newer acceptance exports successfully |
| `DOWNLOAD_INTEGRITY` | Positive download/export controls precede same-length byte tampering; corrupt download returns 500 `EXECUTION_FAILED`; acceptance and fresh/retried export return 409 `EVIDENCE_CONFLICT`; restored bytes succeed |
| `HTTP_BODY_LIMIT` | Exact 8192 UTF-8 bytes reach normal request handling; 8193 bytes fail 413 `INVALID_REQUEST` even below 8192 JavaScript characters; valid padded requirements update succeeds |
| `HTTP_DUPLICATE_JSON` | Top-level, nested and escaped-equivalent duplicate keys fail 400 `INVALID_REQUEST` at the actual HTTP boundary without changing state; unambiguous control succeeds |
| `LATE_RESULT` | Late complete evidence remains stored under its old requirements as superseded; current selection and accepted history survive completion and restart |
| `RESTART_INTERRUPT` | Queued, planning and running work fail once on restart with safe `EXECUTION_FAILED`, cleared active run, two failure events and stable repeated restart/retry |
| `UNAVAILABLE_VISIBLE` | Health/bootstrap disclose absent adapters; a real HTTP run request returns 503 `TOOL_UNAVAILABLE` without a run, candidate, event or silent fixture result |
| `FAILED_EVIDENCE` | Every one of seven required checks independently blocks acceptance when failed or not_evaluated; rejected evidence is inspectable and prior acceptance stays intact |
| `RESET_REPEAT` | Two independent clean sessions perform synthetic acceptance/export/download and restart; identities, artifact bytes and histories stay separate, and foreign downloads fail |

Reproduce from the repository root with installed dependencies:

```sh
node tests/e2e/verify-state-http-tests.mjs
```

The protected checker runs `node --import tsx --test --test-reporter=tap tests/e2e/state-http.acceptance.test.mjs` on baseline and 14 altered disposable copies, with separate healthy controls. It requires all 18 cases, no skips/todos/cancellations, a passing baseline and designated failures in every altered copy. The report and per-copy TAP/control logs are retained under `.runtime/demo-state-http-quality/run-*`, including the suite SHA-256. The independent checker was acceptance setup; the parent owns wrapper run evidence and commits. No receipt is fabricated or backdated here.

Observed worker check on September 8, 2026: **PASS**, 18/18 baseline cases, all 14 targeted alterations detected, and all 15 independent healthy controls passed. No skips, todos or cancellations occurred. The report identifies Node v22.23.1 on darwin/arm64 and suite SHA-256 `dbdaefc1c05a58cc2e3d35537d9f083d1dca8b5aad3a930653f571cb837ad9cb`. This is the worker's protected-check result, not a parent wrapper receipt or integrated product acceptance.

Software sensitivity to those 14 faults does not prove complete correctness, authentication, genuine engineering measurements, isolation enforcement, reopened usable CAD or physical performance. The original integrated case matrix remains **NOT_RUN** for full live execution. This task creates no recording and establishes no live product acceptance.
