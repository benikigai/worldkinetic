# Handle nearest-surface and outboard boundary observations

These files are actual isolated CAD outputs from fixed developer source in the
protected handle acceptance harness. Initial STEP registration and the initial
acceptance descriptor are synthetic developer setup. They do not establish
product provider generation, application acceptance, downloads or physical fit.

The source baseline was `f1f6f430a6cdbe1727b387e938a91a443aba7013`. This followup
repairs nearest-surface evidence in `src/tools/handle_geometry.py`; exact verifier
hashes identify the uncommitted source used for these observations. It preserves
the outboard threshold `>=5-1e-7 mm3` and the independent zero-positive-solid
intrusion check below `25-1e-7 mm`.

| Case | Observed measurement | Check outcome |
| --- | --- | --- |
| valid_initial | Minimum gap 25 mm | All eight checks passed |
| rotated_seam_initial | Minimum gap 25.000000000000004 mm | All eight checks passed |
| outboard_below_minimum | Outboard addition 4.995000000000011 mm3 | Refinement delta failed |
| outboard_at_minimum | Outboard addition 4.999999999999999 mm3 | All nine checks passed |

The rotated grip has three actual closest-point pairs from OCP. Their distances
are 25.000000000000004, 25.000000000000018 and 25.00000000000001 mm. Coordinates
are in `rotated_seam_initial/result.json`, under the clearance measurement and
diagnostics. The original vertex projection incorrectly gave 25.153779611289004 mm.
On the baseline, the five targeted tests below produced four passes and that one
failure; the outboard boundary controls already worked.

```sh
WORLDKINETICS_CAD_LOCK_PATH=/private/tmp/worldkinetics-numeric-cad-501.lock node --import tsx --test --test-name-pattern='reference|valid_initial|rotated_seam_initial|outboard_below_minimum|outboard_at_minimum' tests/tools/handle_acceptance.test.ts
```

Each case retains byte-identical source/editable Python, sealed STEP, trusted STL,
strict sanitized result and provenance. The fresh two-pad reference is saved
locally here so refinement provenance can be reproduced with the exact reference
and initial STEP bytes. No historical reference or v1 files were overwritten.
`hash-manifest.json` covers 28 artifact/provenance files plus ten verifier/pipeline
source hashes. Its SHA-256 is
`b8a78220f39227a05f4a7881a56f1254c787da3d69641dbdd1ca16dc911bda61`.
The README and manifest itself are outside that file map.

Provenance retains actual observation times, staged verifier hashes, original
private result hashes and verified container cleanup. Artifact paths are logical
`/saved-developer-trials/handle/v2/...` identifiers. Raw runtime logs and wrapper
receipts are private and are not copied here. All CAD used the existing shared
host flock and image
`sha256:bba502dc5c3fb943c078cdcb5c0a4b9faa321839ceb59bcfd5c41c33cbe0c440`.

The first worker finished naturally, but its parent run
`TOOLS-HANDLE-01-3813cd3157d4` was INTERRUPTED at the idle CAD boundary. Its output
was preserved at `cf18adb`; the supervisor then corrected protected harness
registration/typing and added strict controls at `f1f6f43`. These new observations
do not turn that interrupted run into a pass or replace its ledger or receipt.

The complete parent-supplied regression command recorded in
[the TOOLS notes](../../../../src/tools/README.md) exited 0 after the repair:
handle 18/18, source 7/7, adapter 6/6, numeric plate acceptance and focused
TOOLS/shared typecheck passed. This is worker-observed verification; the parent
wrapper owns the final receipt, commit and integration decision.
