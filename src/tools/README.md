# TOOLS-HANDLE-01 handle source pipeline

The adapter supports the released `handle_sample_v1` registry with
`handle-validator-v1`: eight initial checks and nine refinement checks. Handle
requests require arbitrary `python_source`; numeric proposals are rejected before
CAD. The preserved plate numeric and source paths remain available.

```ts
import { createHandleReference } from './src/tools/handle_reference.js';

const { referenceArtifact, previewArtifact } = await createHandleReference({
  outputDir: '/absolute/existing-parent/new-reference',
  remainingBudgetMs: 60000,
  signal: abortController.signal,
});
```

The fresh output contains `reference.step`, `preview.stl`, `datums.json` and a
private creation report. The reference is only two radius-7 pads at X=-48/+48,
Y=0, Z=0..2 mm. An isolated fixed constructor creates them; separate trusted
containers reopen the STEP and inspect analytic pads and the actual two-component
watertight, oriented STL. The helper returns private creation descriptors matching
`DispatchReferenceArtifactSchema`. It does not register artifacts, record
acceptance or make files downloadable. BACKEND can register the exact STEP, STL
and canonical JSON bytes in [the saved reference](../../examples/handle/reference/).
The datum is the shared `HANDLE_DATUM_CANONICAL_JSON` verbatim UTF-8 without a
newline, with hash `6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83`.

Generators and independent regenerators receive only `/input/source.py`,
`/input/reference.step`, `/input/datums.json`, and, for refinement only,
`/input/baseline.step`. The reference always retains `handle_mount_reference_v1`;
the baseline is the exact explicitly accepted initial STEP. BACKEND must resolve
its acceptance descriptor from immutable history. TOOLS checks the separate
identities, rereads every regular nonlinked input and verifies actual hashes
before staging, then independently checks baseline geometry against initial
requirements. A descriptor alone is not evidence of product acceptance.
Generated source writes only `/out/candidate.step`; delivered `source.py` and
`editable.py` retain its exact bytes. Trusted verifiers never execute source.

All CAD, including reference creation, uses the existing pinned image and shared
host flock. Lock wait consumes the same request budget. The adapter caps a request
at 180 seconds; generators retain 60-second caps and trusted stages 30 seconds.
Known-container removal must complete before sealing or delivery. Cancellation,
64 KiB source, 25 MiB package and 100,000-triangle limits retain the existing
fail-closed behavior. No dependency, image or rendering stack was added.

Measurements come from reopened OCP geometry: actual planar circular contacts and
cylinder axes, whole contact-layer symmetric difference, envelope, central-column
Boolean intrusion, connected central grip and five actual planar sections.
Refinement measures all initial material removal, per-station width and added
area, added thumb-box/outboard volume and actual protrusion. Initial width limits
do not constrain refinement. The gap uses OCP nearest-shape distance from the
central grip to the panel at Z=0, with actual closest points on both shapes.
Unavailable or nonfinite distance/point evidence cannot pass. Curved surfaces are
measured independently of their seam vertices. The whole central-column Boolean
separately requires zero positive intersecting solids below 25-1e-7 mm, and minimum
gap must be >=25-1e-7 mm, with no 0.01 mm or volume allowance. Thumb addition must
be strictly greater than 25 mm3; outboard addition must be finite and >=5 mm3,
with no epsilon allowance. A nominal boundary measured below five fails.
The panel's 4.5 mm holes are metadata, not handle bores or threads.

The fresh export verifier reopens exact STEP bytes, compares isolated regeneration
by symmetric difference, bounds and applicable checks, and reads binary STL
independently. Mesh checks cover finite vertices, edge pairing, winding,
components, positive signed volumes, bounds, pad rims, contact-layer volume by the
divergence theorem, clipped central-column gap and oriented planar section areas.
STL tessellation first caches protected pad faces at absolute boundary deflection
0.0001 mm, then meshes the whole shape at 0.001 mm. OCP reuses the fine shared
boundaries. Interior deflection stays 0.003 mm and angular limits stay 0.1 rad,
with meshing parallelism disabled. Exact
zero-area float32 pole triangles are removed before the unchanged independent
topology, volume, section and clearance checks. Memory and triangle caps remain.
It does not reuse the plate bore assumptions. Unsupported or unestablished
geometry cannot produce a passing export. Missing section contours and
geometric conflicts retain failed records; malformed files or failed execution
produce infrastructure errors with no artifacts or passing checks.

Actual fixed developer observations are saved in
[trials/v1](../../examples/handle/trials/v1/) with exact source/editable/STEP/STL
bytes, sanitized strict results and a hash manifest. Each provenance file records
the verifier bytes actually staged, observation start/end times, original private
result SHA-256 and sanitized result SHA-256. Sanitized artifact paths are logical
`/saved-developer-trials/...` references, not registered downloads. The unchanged
check-bundle hash is reverified after path sanitization. Raw runtime results and
stderr remain private. Saved checks describe those exact files and verifier
snapshots, not later edits or integrated runtime behavior.

The developer driver supplies a synthetic registered initial STEP ID and synthetic
acceptance descriptor. Its fixed source is never product model-generation evidence.
The [nine-check fixture](../../fixtures/tools/handle-v2-result.fixture.json) uses
fixture provenance at result/check/artifact levels, a fixture engine and a
recomputed bundle. It is transport conformance data, not a live run.

```sh
node --import tsx src/tools/check_handle_cases.ts
# Save the focused direct-run evidence into a fresh v3 directory:
node --import tsx src/tools/save_handle_boundary_trials.ts /absolute/private-trial-directory v3
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --resolveJsonModule src/tools/adapter.ts src/tools/handle_reference.ts src/tools/check_handle_cases.ts src/tools/save_handle_trials.ts src/tools/save_handle_boundary_trials.ts
```

The first handle run `TOOLS-HANDLE-01-3813cd3157d4` remains INTERRUPTED;
its worker output and the harness registration failure were preserved. The
nearest-surface followup `TOOLS-HANDLE-01-VERIFY-bf021854d7a1` passed its protected
18 handle, 7 source and 6 adapter tests, numeric regression and focused typecheck
at `bdd3379`. Its [v2 artifacts](../../examples/handle/trials/v2/) retain the actual
measurements and verifier hashes. That version still accepted a measured
4.999999999999999 mm3 through an epsilon, which did not satisfy the frozen minimum.

The final threshold correction is direct work, `OUTSIDE_WRAPPER`. Its numeric
policy test evaluates the production decision: exact 5.0 passes, while 5-5e-8,
the next float below five, NaN and infinity fail. This is numeric decision
coverage, separate from real CAD evidence. The unchanged nominal-five geometry
is judged by its actual measured volume. A separate 5.001 mm3 material-margin
case provides the positive geometry control. Historical v1/v2 bytes and receipts
are unchanged; [v3](../../examples/handle/trials/v3/) records the new real source,
STEP, STL, regenerated editable source, checks and verifier hashes.

Reproduce the focused final checks:

```sh
python3 -B tests/tools/handle_volume_threshold.py
node --import tsx --test --test-name-pattern='^(reference has|valid_initial$|rotated_seam_initial$|valid_refinement$|outboard_below_minimum$|outboard_at_minimum$|outboard_with_material_margin$)' tests/tools/handle_acceptance.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --resolveJsonModule src/tools/adapter.ts src/tools/handle_reference.ts src/tools/save_handle_boundary_trials.ts tests/tools/handle_acceptance.test.ts
```

BACKEND still owns Responses generation, real acceptance/history resolution,
registration, routes and downloads. UI integration and model repair are not
established by these trials. Strength, physical fit, comfort, fabrication and
manufacturing readiness are not checked or claimed.

---

# TOOLS-03 source candidates and frozen feature verification

`adapter.ts` exports `cadToolAdapter: ToolAdapter` from the released
`src/shared/contracts-v2.ts` interface. It supports `numeric_operation` / `resize_plate` with the exact confirmed length,
and `python_source` for `resize_centered_v1` and `tactile_feature_v1`, using
`plate-validator-v1`. Unknown validators return `TOOL_UNAVAILABLE` with no checks
or artifacts. Installed-runtime source failures return explicit infrastructure
errors, never an unavailable-source fallback.

```ts
import { cadToolAdapter } from './src/tools/adapter.js';
import { verifyToolInput, verifyToolResult } from './src/shared/contracts-v2.js';

const input = await verifyToolInput(serializableInput);
const result = await cadToolAdapter({ ...input, signal: abortController.signal });
await verifyToolResult(result, input);
```

The adapter removes the local signal before strict shared input verification.
Unparseable or contradictory inputs reject the promise before CAD; dispatched
valid inputs receive matching structured results with fixed `safeError` messages.
All run/request/design/revision/attempt identities, requirements and proposal are
echoed. Checks use frozen definitions, methods, units and expected values; actual
core measurements and methods remain in `measured`, with measured margin point
pairs in `diagnostics.pointPairs`. The proposal and full bundle use shared hash
helpers. A completed result with a failed margin remains `completed`, allowing
BACKEND to record a rejected candidate. This adapter never accepts a revision.

An explicit `referenceArtifact` supplies the fixed original plate reference independently
of the current input revision. Without it, only the released `baseline_50` and
`fixture_baseline_50` legacy bindings are accepted. The adapter checks regular, non-symlink source bytes before CAD
and stages a read-only copy. It also stages validated requirements and the exact
registry/setup canonical strings. Python hashes those strings directly as UTF-8
and verifies their fixed registry identity, resolved setup, length and reference
agreement. Only trusted verifier stages receive these bindings; generators
receive exactly the source and immutable reference STEP. `--requirements-json` exposes this optional internal CLI
envelope (`requirements`, `registryCanonicalJson`, `setupCanonicalJson`). It is
not a provider argument or public route.

`cad_runner.py` is an internal numeric/source CLI. The host requires Python 3.9+
and Docker; only containers import CAD libraries. No dependencies were added.

```sh
python3 -B src/tools/cad_runner.py --length-mm 36 \
  --output-dir /absolute/existing-parent/new-output \
  --reference-step examples/plate/revised/plate-50x35x5.step \
  --reference-sha256 9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3 \
  --deadline-seconds 60
```

For source input, additionally pass `--source-file /absolute/candidate.py` and the
validated `--requirements-json` envelope when using the frozen feature setup.
The adapter supplies both automatically. Source is raw UTF-8, at most 65,536
bytes, with no normalization. Delivered `source.py` and `editable.py` are byte
identical and their hash must match the proposal. Each of two independent
candidate containers runs `/input/source.py` with read-only
`/input/reference.step`; it may use the installed build123d API to construct any
shape and must export only `/out/candidate.step`. No verifier, config or
requirements files enter either candidate container. Syntax/runtime errors,
partial execution, forged reports, symlinks and excess output deliver no checks
or artifacts. A completed geometric conflict retains its measured checks.

For `tactile_feature_v1`, all nine frozen registry checks apply. The trusted
baseline is 50 x 35 x 5 mm, with fixed diameter-6 bores at (15,17.5) and (35,17.5).
Base-layer intersection at z=0..5 is compared geometrically against that baseline;
base thickness remains 5 mm and total bounds are [0,50] x [0,35] x [0,7]. The
candidate must be one valid connected solid. Whole-baseline removal and each
radius-4 protected-cylinder symmetric difference must be <=0.01 mm3. Added
material is computed as candidate minus exact reference: volume strictly >1 mm3,
X/Y/Z spans in [8,10]/[3,5]/[2,2] mm within 0.01 mm, and volume outside
[20,30] x [25,30] x [5,7] <=0.01 mm3. These are geometric requirements, not a
hardcoded feature operation.

Bore identification uses axis, center, radius and base depth, allowing unrelated
cylindrical feature faces. Boolean probes require zero obstructing solids through
the entire candidate height, even for a cap smaller than the volume tolerance.
The independent STL reader measures circular rims at z=0 and z=5, checks actual
raised-feature bounds, and tests every triangle for bore-interior obstruction.
It retains topology, winding, connectedness, volume, bounds and mesh tolerance
checks. Added features may contain other tunnels; their topology is not mistaken
for the two required base bores. Non-extruded bore walls that this reader cannot establish remain
`not_evaluated`, blocking acceptance. Feature/protected failures include actual
Boolean volumes, defect bounds and measured point pairs when available.

The [source feature fixture](../../fixtures/tools/source-feature-v2.fixture.json)
is labeled `fixture` at the result, engine, check and artifact levels and has a
recomputed bundle. The [source trial](../../examples/plate/trials/source-feature-v1/README.md)
contains actual isolated fixed-source execution outputs, full v2 result and
hashes. These are synthetic developer inputs, not product Responses generation,
model repair, user acceptance or physical testing. Additional edge cases run via
`node --import tsx --test src/tools/check_source_cases.ts` using the same adapter
and shared flock. Historical fixture/trial snapshots remain unchanged.

Legacy reference-in-`inputArtifacts` dispatch remains baseline-only. Explicit
plate `referenceArtifact` dispatch is now supported; it preserves the original
`baseline_50` identity while current input artifacts retain their own revision.
The model loop, artifact serving and application integration remain BACKEND work. No native sketch/history reconstruction or
consumer fit is claimed.

The output directory must not exist. Its parent must exist, and paths cannot
contain symlinks. JSON stdout is the internal result; successful computation
also writes `result.json`, `source.py`, `editable.py`, `candidate.step` and
`preview.stl`. The source and editable files have identical bytes. The adapter
returns four private descriptors: source (`text/x-python`), editable
(`text/x-python`), sealed STEP export (`model/step`), and trusted STL preview
(`model/stl`). It rereads the regular files, checks exact sizes/hashes and limits
the entire output directory to 25 MiB. The internal `result.json` is not a public
artifact. BACKEND must register and reverify the private descriptors before
serving downloads; do not forward their paths or internal CLI logs to a browser.
STEP/STL coordinates are mm in a right-handed Z-up frame at the minimum plate
corner. Width is 35, thickness 5, bore diameter 6 and centered pitch 20 mm.
Length 30 stays 30: its actual 2 mm margin fails the 5 mm requirement. Lengths
50 and 36 measure 12 and 5 mm respectively. These are fixture operations.

The seven `resize_centered_v1` records distinguish passed, failed and
not_evaluated. Geometric conflicts return exit 0 with `status: check_failed`
and `checkFailureCode: CHECK_FAILED`; infrastructure and input errors return
nonzero with `error.code` and no passing checks. A checked candidate remains
unaccepted and physically untested. No FreeCAD history or FCStd is claimed.
The callable adapter binds those files to BACKEND's v2 contract. Public routes,
state, artifact delivery, application integration and user acceptance remain
BACKEND work. No FEA, Blender rendering, FCStd history or consumer fit is claimed.

Execution is serialized by a per-user host lock. `WORLDKINETICS_CAD_LOCK_PATH`
selects an absolute shared host path; BACKEND should set it consistently across
worktrees. The default is the platform-resolved `/tmp` directory plus
`worldkinetics-numeric-cad-<uid>.lock`, independent of per-job `TMPDIR`. The lock
must be a regular non-symlink file owned by the current user with no group/other
permissions. It is never mounted into a container. A single global deadline
covers validation, staging, lock wait, runtime inspection and all four stages.
When both `deadline` and `remainingBudgetMs` are provided, the earlier limit wins,
including time already spent. Generators each have a 60-second cap; verifier and
export verifier each have a 30-second cap, all bounded by the global deadline:

1. `generator` executes the delivered editable source with no verifier code.
2. `regenerator` independently executes those same source bytes.
3. `verifier` imports sealed candidate/reference/regenerated STEP; measures
   actual planes, OCP cylinders, full-height bore obstruction and OCP extrema
   closest-point pairs; exports STL from the checked candidate.
4. `export_verifier` independently imports the exact sealed export and
   regenerated STEP, compares both Boolean differences, bounds, holes and
   volumes, and reopens the binary STL. Mesh checks cover exact edge topology,
   orientation, connectedness, volume, bounds, fitted circular rims, base-depth
   bore walls with full-candidate-height obstruction testing and triangle projections into bore interiors. Unsupported bore
   wall geometry returns not_evaluated rather than a guessed pass.

Each stage uses the selected image ID below with a nonroot UID, read-only root,
no network, no capabilities, no-new-privileges, 2 GiB memory/swap, 2 CPUs,
64 PIDs, a 25 MiB file-size limit and 128 MiB bounded tmpfs. Only its private
immutable input and private output directories are mounted. Candidate stages
receive source and reference only. Trusted stages receive no candidate Python. Unique named
containers are created before startup, stopped/removed before sealing, and
absence is checked through Docker. Active cancellation sends SIGTERM to Python
and waits for its completion and known-container cleanup before returning
`RUN_TIMEOUT`; pre-aborted/expired requests do not start CAD. Cancellation during
cleanup is deferred until removal finishes, then stops before the next stage.
Cleanup has explicit 5-second command grace periods, up to 20 seconds total for
resolving/killing create, waiting for the CLI, removing and checking absence,
even when the computation deadline expires. Failed cleanup prevents
artifact delivery. Stage traces include actual container names and sealed hashes.

The host rejects unexpected, linked, missing or oversized outputs; source is
limited to 64 KiB, delivered files to 25 MiB total and STL to 100,000 triangles.
Raw failures and per-stage logs remain in private `worldkinetics-cad-*`
directories under the host temporary directory. They are not public artifacts.
Only complete successful-computation packages are written to the requested path.
A hard host kill or unavailable Docker daemon can prevent cleanup confirmation;
this core is not a public multi-tenant service.

Host environment names are `WORLDKINETICS_CAD_IMAGE`,
`WORLDKINETICS_CAD_LOCK_PATH`, `TMPDIR` (private staging) and `PATH` (Python/Docker
lookup). Container environment names are `HOME`, `OPENBLAS_NUM_THREADS` and
`OMP_NUM_THREADS`; host environment and credentials are not forwarded.
`WORLDKINETICS_CAD_IMAGE` defaults to the exact selected immutable image ID. An
explicit tag is allowed only if local inspection resolves to that same ID.
The runner never pulls, builds or changes an image. The transferred
`scripts/runtime/cad.Dockerfile` pins the documented base digest and includes
libgl1, libglu1-mesa and libgomp1; `cad-requirements.txt` pins the protected
observed Python packages. Packaging is source-consistency-checked, not rebuilt.
Apt package versions are not locked, so it does not promise identical rebuilds.

Protected acceptance (owned by the parent):

```sh
node --import tsx --test tests/tools/source_acceptance.test.ts && node --import tsx --test tests/tools/adapter.test.ts && python3 -B tests/tools/plate_acceptance.py && npm run typecheck
node --import tsx src/tools/check_adapter_cancel.ts
```

Run CAD checks serially. `tests/tools/stage_deadline.py` actually waits for the 30-second
verifier cap and checks removal; `check_adapter_cancel.ts` observes a running
generator, aborts through the adapter and checks absence before delivery.
The root typecheck does not include `src/tools/**`; check it directly with:

```sh
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --resolveJsonModule src/tools/adapter.ts src/tools/check_adapter_cancel.ts src/tools/check_source_cases.ts
```

The numeric core was previously verified at `2bd015d`; the shared v2 release
was merged from `23a8360`. These are earlier evidence boundaries, not this
worker's receipt. The parent owns execution evidence, review and commits under
`docs/development-evidence.md`. The [numeric trial fixture](../../fixtures/tools/numeric-core-trial.json) records
actual CLI fixture executions, not user acceptance or application integration.
Historical `check_numeric_core.py` probes require an externally held shared CAD
flock before invocation because they call internal stages directly. They exercise a thin bore cap, misplaced holes, extra solids, mesh failures,
symlinks, unexpected outputs and truncated STL.
The new [v2 shape fixture](../../fixtures/tools/plate-v2-result.fixture.json) is
synthetic, explicitly labeled `fixture` throughout and uses fake private paths.
It does not replace saved numeric or engine-gate observations.
The following TOOLS-01 account is historical immutable observation context;
its scope and gaps refer to that earlier gate.

---

# TOOLS-01 engine gate

The supervisor ran the fixed acceptance harness in `tests/tools/runtime_gate.py`
and froze 31 passing observations in `tests/tools/engine_gate_observed.json`.
That runtime experiment is **OUTSIDE_WRAPPER**. This document worker only authored
the evidence package, copied the exact observed exports, and ran the document
consistency checker. It did not execute CAD. No model-generated product CAD has
been run; the fixed probe source was supervisor acceptance setup.

Select **build123d 0.11.1** for the next application adapter implementation on the
basis of this runtime gate. The adapter is `not_implemented`; passing this gate
does not establish an integrated product or accepted design.

The [evidence package](../../fixtures/tools/engine-gate.json) preserves the
protected observation unchanged and records the copied artifact hashes, scope,
parameters and coordinate frame. The engine is arm64 with
`cadquery-ocp-novtk` version `7.9.3.1.1`.

## What ran and what was measured

The harness ran separate disposable boundary, generator, verifier, lingering-child
and timeout probes. After the generator container stopped and was removed, the
harness copied its STEP to a read-only sealed file and hashed it. A fresh verifier
container imported a read-only copy of that STEP, measured its geometry and
exported the preview STL. Host-side code independently parsed the binary STL.
The verifier did not execute generator source or accept generator measurements.

The fixed plate uses mm in a right-handed, Z-up frame. Its minimum bounding-box
corner is (0, 0, 0), maximum is (50, 35, 5). Two diameter 6 mm bores run along Z
through the 5 mm thickness at XY centers (15, 17.5) and (35, 17.5), 20 mm apart.
These are harness parameters, not a separately regenerated editable-source package.

| Measurement | Observed result | Harness criterion |
| --- | --- | --- |
| STEP validity / solids | Valid, one solid | Valid and exactly one solid |
| STEP dimensions | 50 x 35 x 5 mm | Each dimension within 0.01 mm |
| STEP volume | 8467.25666117691 mm3 | Relative error <= 0.00001 against 8467.256661176918 mm3 |
| Solid intersection with each bore cylinder | 0, 0 mm3 | Maximum <= 0.01 mm3 |
| Binary STL layout | 1028 triangles, 51484 bytes | 84 + 50 bytes per triangle; 1 to 100000 triangles |
| STL signed volume | 8467.373835628394 mm3 | Absolute-volume relative error <= 0.001 against analytical plate volume |
| STL dimensions | 50 x 35 x 5 mm | Each dimension within 0.01 mm |

The STL exporter used linear tolerance 0.001 and angular tolerance 0.1. STL carries
no unit metadata; this package interprets its coordinates as mm. Empty bore
intersections establish the specific solid probe result, not full mesh holes
acceptance.

Boundary probes observed non-root execution, denied host-sentinel reads, denied
reference/root writes, absent Docker socket and verifier path, and a failed
outbound socket connection. The revised reference STEP hash remained
`9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3`.
The generator and verifier stopped successfully and their containers were removed.
A started background child left no escape marker after removal. The forced
timeout also left no escape marker and failed closed.

Recorded stage durations, including cleanup, were 0.29 s for boundary, 1.632 s
for generation, 1.539 s for verification, 0.188 s for linger and 2.103 s for the
forced timeout. These are single-run measurements, not pure CAD timings or a
latency guarantee. The harness additionally waited 5.5 s after each child probe.

## Saved artifacts

Both files below are byte-for-byte copies from the protected observation's private
`.runtime/tools/gate/acceptance-8b5ac8d21a/` paths. They are gate exports, not
user-accepted product artifacts. Original and revised reference files remain intact.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| [sealed.step](../../examples/plate/trials/engine-gate/sealed.step) | 22575 | `9eb39e206b6d59e80a115e29798d8b3256d31bcc6e1a0b7d329411a9a4c12d43` |
| [preview.stl](../../examples/plate/trials/engine-gate/preview.stl) | 51484 | `0234291b295c315aeb045a13b52e2f8426e389f2ef0525c422e512816bc276c0` |

## Runtime image and reproduction

The supervisor's final local image tag was
`worldkinetics-tools-gate:build123d-0.11.1-gl`, with immutable image ID:

```text
sha256:bba502dc5c3fb943c078cdcb5c0a4b9faa321839ceb59bcfd5c41c33cbe0c440
```

The build recipe used the pinned `python:3.11-slim` base below, installed
`build123d==0.11.1` with pip, then added the missing system libraries. Equivalent
Dockerfile instructions documenting that sequence are:

```dockerfile
FROM python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534
RUN pip install build123d==0.11.1
RUN apt-get update && apt-get install -y libgl1 libglu1-mesa libgomp1
```

This documents the supervisor's dependencies; this worker installed none. Pip
transitive dependencies and apt package versions are not fully locked by that
recipe, so rebuilding is not a promise of identical image bytes. The recorded
local image ID identifies the tested runtime. Root runtime packaging and
dependency pins remain BACKEND-owned.

To reproduce the runtime experiment from the repository root on a Docker host
with the image available:

```sh
python3 tests/tools/runtime_gate.py
```

`WORLDKINETICS_CAD_IMAGE` selects the image; the harness defaults to the tag above.
To reproduce against the exact tested image, the supervisor should select its
recorded immutable ID through that variable. The command creates a fresh private
acceptance directory and observations under `.runtime/tools/gate/`; it does not
replace the protected report. This worker did not run that command.

Each probe uses a read-only root filesystem, no network, UID/GID 65532:65532,
all capabilities dropped, and `no-new-privileges`. Configured resources are 2 GiB
memory with memory-swap also 2 GiB, 2 CPUs, 64 PIDs, a file-size ulimit of
26214400:26214400, and a 128 MiB `/tmp` tmpfs with `noexec,nosuid`. The file-size
limit is not an aggregate output-directory quota. The default probe deadline is
60 s, verifier deadline 30 s, and deliberate timeout deadline 2 s.

Exactly two bind mounts expose only the stage input at `/input` read-only and its
private output at `/out` writable. The harness makes the output directory mode
0777 for the non-root container. It mounts no project root, home directory,
credentials or Docker socket. Stage inputs contain the fixed probe plus only
needed geometry. Container environment-variable names are `HOME`,
`OPENBLAS_NUM_THREADS` and `OMP_NUM_THREADS`; no credential values are supplied.
The harness inspects configured controls, then force-removes each container and
checks absence. It does not stress-test every configured resource limit or prove
general isolation against arbitrary hostile code.

## Earlier attempts

1. Native FreeCAD 1.1.3 under a deny-default macOS sandbox exited `-6` before
   geometry. That attempt did not establish a working native sandbox path.
2. The first build123d image failed importing `libGL.so.1`. Adding `libgl1`,
   `libglu1-mesa` and `libgomp1` enabled import.
3. The independent harness initially accessed `.volume` on an empty Boolean
   result. The supervisor corrected `None` to zero in the acceptance setup;
   all probes then passed. This worker did not change the protected harness.

Failed observations remain private in
`.runtime/tools/gate/acceptance-6fddeceea6` and
`.runtime/tools/gate/acceptance-7223ad77eb`. Raw runtime logs are not copied into
this public evidence package.

## Known gaps and document check

Full acceptance registry checks are `not_evaluated`, including protected-interface
comparison, clearance/hole-margin acceptance and fabrication-profile checks.
Full STL watertightness, connectedness and holes acceptance are `not_evaluated`;
the binary layout, bounds and volume tests do not establish those properties.
Separate editable-source regeneration is `not_evaluated`.

Application adapter, artifact registration, revision/requirements binding,
generation/repair loop and user acceptance are not implemented by this gate.
Physics, FEA, Blender rendering and physical fit are `not_evaluated`. No new
FCStd or native FreeCAD history is provided or promised. Existing FreeCAD reference
files retain their original status.

The protected document/evidence checker is:

```sh
python3 -B tests/tools/check_gate_report.py
```

It checks equality with the frozen observation, the declared scope, exact saved
STEP/STL bytes and required documentation distinctions. It does not execute CAD
or turn OUTSIDE_WRAPPER runtime evidence into a worker runtime result. The parent
wrapper owns its verification ledger, receipt and commit.
