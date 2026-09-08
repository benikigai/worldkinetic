# Released handle shared contract

BACKEND-HANDLE-01 provides source/schema evidence for `wk-prototype-0.2`. It does not generate CAD, register actual acceptance, or enable handle execution. The original plate registry, canonical hashes and legacy fixtures remain unchanged. No dependencies were added.

Use `Requirements` and `ResolvedSetup` as plate/handle unions. Narrow `requirements.registryId` or `setup.registryId` before accessing geometry. Plate properties retain their existing shape; handle controls are under `setup.geometry` and have no plate dimensions or bores.

```ts
import {
  createHandleRequirements, HANDLE_DATUM_SHA256,
  verifyRequirements, checkDefinition, expectedForCheck,
  type Requirements,
} from '../../../src/shared/contracts-v2.js';

// Server-only descriptor: original STEP bytes must already be registered and hashed.
const reference = {
  referenceId: 'handle_mount_v1' as const,
  revisionId: 'handle_mount_reference_v1' as const,
  stepSha256: registeredMountStepSha256,
  datumSpecSha256: HANDLE_DATUM_SHA256,
};
const initial = await createHandleRequirements({
  designId: 'handle', requirementsVersion: 1, setupId: 'handle_initial_v1', reference,
});
const refined = await createHandleRequirements({
  designId: 'handle', requirementsVersion: 2, setupId: 'handle_refine_v1', reference,
  acceptedInitial: descriptorResolvedFromAcceptanceHistory,
});
await verifyRequirements(refined);

function geometryControls(requirements: Requirements) {
  if (requirements.registryId === 'handle_sample_v1') return requirements.setup.geometry;
  return requirements.setup.dimensions;
}
const definition = checkDefinition(initial.requiredChecks[0]!, initial.registryId);
const expected = expectedForCheck(initial, initial.requiredChecks[0]!);
```

`createRequirements` and `resolveSetup` remain plate-only constructors and return `PlateRequirements` and `PlateResolvedSetup`. `createHandleRequirements` returns `HandleRequirements`; its strict `CreateHandleRequirementsInput` union rejects numeric dimensions and all unknown keys. Initial input must omit `acceptedInitial`; its resolved setup contains `acceptedInitial: null`. Refined input must supply every descriptor field below, and its requirements version must exceed the initial descriptor version. `validatorVersion` is optional, defaulting to `handle-validator-v1`.

The immutable IDs are registry `handle_sample_v1`, stages `handle_initial_v1` and `handle_refine_v1`, reference `handle_mount_v1`, and original reference revision `handle_mount_reference_v1`. Caller-provided actual STEP SHA-256 is mandatory and nonnull. The geometry registry retains its planning-null `referenceStepSha256`, `datumSpecSha256` and `baselineSha256`; these slots never supply actual identities.

The resolved setup binds registry ID/hash, units, stage, reference ID/hash, the complete reference descriptor, frozen `geometry`, required checks and `acceptedInitial`. Refinement binds `acceptanceId`, original accepted `revisionId`, STEP `artifactId` and `sha256`, original `requirementsId`, `requirementsVersion`, `setupHash`, `sourceSha256` and `checkBundleHash`. All enter `setupCanonicalJson` and its SHA-256 `setupHash`. Requirements IDs use the existing `req_` plus first 32 hex characters of SHA-256 over canonical `{designId, requirementsVersion, setupHash, validatorVersion}`.

A structurally valid descriptor, file hash or artifact text is not proof of acceptance. BACKEND-HANDLE-02 must resolve the descriptor from actual immutable acceptance history, verify the original initial-stage requirements and exact checked STEP/source/check bundle, require the same design and original reference, and apply current-state rules before dispatch. Public bodies cannot supply this descriptor. No history lookup or acceptance-store stage switch is implemented here; existing store update handling rejects handle stages.

The exported `HANDLE_REGISTRY_CANONICAL_JSON` and `HANDLE_REGISTRY_HASH` cover the complete handle registry including check methods. `HANDLE_REGISTRY_FILE_SHA256` identifies the formatted registry file. `HANDLE_DATUM_CANONICAL_JSON` is exactly the single line below, UTF-8, with no trailing newline. Its SHA-256 (`HANDLE_DATUM_SHA256`) is `6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83`.

```json
{"assumedEnvelopeMm":{"x":[-70,70],"y":[-20,20],"z":[0,50]},"axesMm":[[-48,0,0],[48,0,0]],"axisDirection":[0,0,1],"frame":{"handedness":"right","origin":"midpoint_between_mount_axes","panelPlaneZ":0,"positiveZ":"outward","x":"handle_length"},"padRadiusMm":7,"padZRangeMm":[0,2],"referenceContainsHandle":false,"referenceId":"handle_mount_v1","referenceKind":"trusted_mount_datums_and_two_pad_solids","referenceSolidCount":2,"revisionId":"handle_mount_reference_v1","units":"mm"}
```

The datum contains only frame, axes, two radius-7 pads between Z=0 and Z=2, envelope and reference identities. It contains no grip, thumb rest, accepted candidate or prebuilt handle. A matching JSON object with different whitespace is not the same datum byte sequence. All canonical encoding uses `src/shared/canonical-json.ts`: finite JSON, UTF-16 lexicographic object keys, ECMAScript JSON primitive encoding, sorted `checks`/`requiredChecks` sets, otherwise ordered arrays, UTF-8, no trailing newline. Duplicate JSON keys and duplicate named check IDs are rejected.

`checkDefinition(checkId, registryId?)` defaults to the unchanged plate registry. Handle callers must pass `handle_sample_v1`, including for shared export check IDs. `expectedForCheck(requirements, checkId)` uses the frozen registry and stage, never provider thresholds. Initial has eight required checks; refinement adds `handle.refinement_delta`. Check units now include `mm2`. Expected exports refer to handle checks and the original reference, without plate dimensions or hole-layout claims. Refinement expectations include material preservation, all five station width/area increases, thumb-rest added volume, protrusion and outboard volume. Initial-only width/Y limits are null in refined section expectations.

`ToolInputData.referenceArtifact` uses `DispatchReferenceArtifactSchema`:

```ts
{
  referenceId: 'handle_mount_v1', artifactId: registeredMountArtifactId,
  revisionId: 'handle_mount_reference_v1', kind: 'reference', units: 'mm',
  path: privateMountPath, sha256: reference.stepSha256,
  datumSpec: { path: privateDatumPath, sha256: HANDLE_DATUM_SHA256 },
}
```

Initial dispatch has `inputRevisionId: 'handle_mount_reference_v1'` and `inputArtifacts: []`. Refinement sets `inputRevisionId` to the accepted initial revision; every `inputArtifacts` descriptor must belong to that revision, with unique IDs and exactly one matching accepted STEP `artifactId`, `sha256` and `kind: 'export'`. Other artifacts may belong to that same revision. The separate reference always retains the original mount revision, reference ID, hash and datum; it must never be relabeled as the accepted revision.

An explicit plate reference uses `referenceId: 'plate_revised_50x35x5'`, `revisionId: 'baseline_50'`, the frozen plate STEP hash and no datum descriptor. Only existing baseline legacy inputs can omit it: original `baseline_50` with a matching reference hash, `fixture_baseline_50` with `fixture_reference_step`, and the existing `synthetic_test_design` / `synthetic_initial` / `baseline_test` backend fixture. Each legacy input contains one reference artifact. Any other plate revision requires an explicit fixed reference.

`verifyToolInput` checks descriptors, frozen requirements/canonical bytes, proposal restrictions and revision bindings. `verifyDispatchArtifacts` from `src/server/dispatch-integrity.ts` first calls it, then opens every private reference/datum/input file, rejects missing files, symlinked artifact files and nonregular files, limits reads to 25 MiB per artifact and verifies SHA-256. It also compares datum bytes directly to the fixed canonical sequence. It does not execute source/CAD or infer acceptance from file contents. Operating-system parent aliases such as macOS `/var` remain usable. Private paths and immutable mounts must remain under trusted dispatcher control; this check is not an execution sandbox.

The future generator mount contract is `/input/reference.step` for the original two-pad STEP and, only in refinement, `/input/baseline.step` for the actual accepted initial STEP. The trusted datum can be mounted as `/input/datums.json`. Candidate Python must write `/out/candidate.step`. Source remains the existing `python_source` proposal with a maximum of 65,536 UTF-8 bytes. Numeric operations fail for both handle stages. Generation, sealing, verification and acceptance remain separate authorities.

Public run, event, candidate, artifact and acceptance envelopes are reused. Requirements updates accept either handle stage with `confirmedIntent: {}` and existing request/CAS/user-action fields only. References, geometry controls, checks and accepted IDs cannot be injected into that body. Source/schema support does not activate the store or CAD adapter.

`handle-reviewable.fixture.json` is a Bootstrap transport fixture with one candidate and eight actual-shaped check records, exact requirement/check-bundle binding, synthetic source/artifact hashes, `executionMode: 'fixture'`, a fixture engine and `acceptedRevisionId: null`. Every measurement is invented conformance data explicitly labeled synthetic, not actual geometry. Artifact links demonstrate transport shape and do not establish available downloads. Fixture artifacts are not CAD or physically tested evidence.

Validation: `node --import tsx --test tests/backend/*.test.ts && node --import tsx scripts/build.ts`. The backend runtime suite and production bundle are the released gate. The diagnostic `npx tsc --noEmit` still reports owner migration work at these exact locations:

| Consumer | Locations | Required narrowing |
| --- | --- | --- |
| `src/client/workspace/review.ts` | 43:65, 44:61, 52:55, 63:89, 68:132 | Plate dimensions and minimum end material |
| `tests/backend/api.test.ts` | 388:87, 503:47 | Plate dimensions |
| `tests/backend/store.test.ts` | 117:77, 119:165, 139:49 | Plate dimensions |

No server/shared diagnostics remain. The current TOOLS adapter produced no diagnostics through the production import graph; no TOOLS files were edited. Client and protected test consumers must narrow by registry ID or explicitly parse `PlateRequirementsSchema` where they require a plate. Production build success does not establish whole-app typecheck success, CAD behavior or actual acceptance. Runtime handle mounting, history resolution, generation and independent geometry verification remain separate integration work.
