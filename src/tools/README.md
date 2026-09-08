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
