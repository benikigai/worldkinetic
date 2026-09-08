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

Import schemas and inferred types from `src/shared/contracts-v2.ts`. All objects are strict. The table documents the current local routes. Fixture responses have no live fallback.

| Surface | Schema and exact example |
| --- | --- |
| `GET /api/bootstrap` | `BootstrapSchema`; `reviewable.fixture.json`, `rejected.fixture.json` |
| `POST /api/runs` | `RunRequestSchema`; `run-request.fixture.json` |
| Run polling | `RunSchema`; each bootstrap's `runs` array. `GET /api/runs/:runId`; `GET /api/runs` returns `{contractVersion,runs}`. |
| Event delivery | `EventSchema`; `event.fixture.json`. `GET /api/runs/:runId/events?after=0` and `GET /api/events?after=0` return `{contractVersion,events}`; polling only, no SSE. |
| `PATCH /api/designs/:designId/requirements` | `RequirementsUpdateRequestSchema`; `requirements-update-request.fixture.json`. Design identity is in the route. |
| `POST /api/revisions/:revisionId/accept` | `AcceptanceRequestSchema`; `acceptance-request.fixture.json`. Route revision must equal `candidateRevisionId`. |
| `POST /api/revisions/:revisionId/export` | `ExportRequestSchema`; `export-request.fixture.json`. The server must resolve and bind revision, acceptance and manifest. |
| `GET /api/artifacts/:artifactId` | `ArtifactSchema` descriptors in the bootstrap; immutable registered ID URL. No private path in public descriptors. Downloads include execution and current/historical applicability headers. |

`GET /api/fixtures/bootstrap?state=reviewable|rejected` returns the corresponding frozen bootstrap. `GET /api/fixtures/run` and `/api/fixtures/events` return v2 fixture DTOs. Registered fixture artifact URLs serve the exact labeled synthetic bytes, never CAD geometry.

Mutation responses include `contractVersion` and `reused`. Run creation adds `run` (202 first queue, 200 retry). Requirements updates add `design` and `requirements` (200). Acceptance and export add immutable `acceptance` and `manifest` snapshots (200). `GET /api/candidates/:revisionId`, `/api/acceptances/:acceptanceId`, and `/api/manifests/:manifestId` return their DTO directly. Acceptance/manifest schemas are narrowly defined in `src/shared/state-v2.ts`; the released v2 request, candidate and tool schemas are unchanged.

An acceptance stores the exact request, accepted timestamp/state version, full candidate and requirements. A manifest binds its ID and acceptance ID to design/run/revision, requirements, geometry/source/proposal/check-bundle hashes, engine, checks, change summary, millimeter units and registered artifact descriptors. `manifestHash` hashes canonical JSON of the complete manifest with only `manifestHash` omitted. Packaging references existing checked bytes. Export revalidates the current accepted revision, exact acceptance/manifest and all artifact bytes. A requirements change blocks current export but preserves labeled historical artifact GETs. An old acceptance retry returns its original record without restoring current state.

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
