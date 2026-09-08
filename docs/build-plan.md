# Prototype build plan

September 8, 2026. PLAN-01 scope and semantics are released. Implementation observations and gate statuses throughout this plan describe the historical snapshot at `4090c8166a2e52eb3e16e094d42c7bd1423407a8`, around 13:14 PDT, not whichever commit includes this documentation. Newer accepted commits may supersede these snapshot statuses. At that snapshot, local API access and isolated CAD capability setup had passed separately; the first integrated CAD loop, executable v0.2 contract, functional viewer and integrated DEMO acceptance were pending. See [provenance](provenance.md#evidence-snapshot) for the exact evidence scope.

## Completion gates

The core result is a real generated plate feature, independent measurements, bounded repair, explicit user acceptance and download of the exact checked source/STEP/STL. Preserve the original plate and landing design. The [architecture](architecture.md#reference-setups-and-exact-checks) defines the two separate setups and required checks.

| Gate | Status at the cited snapshot | Owners and dependencies | Concrete completion evidence |
| --- | --- | --- | --- |
| M0: Capability setup | Passed locally, packaging pending | PLAN semantics; BACKEND API access; TOOLS isolation | Separate one-shot Responses access and isolated plate generation/STEP verification with recorded image digest. These do not satisfy M1. |
| M1: First integrated plate loop | Pending | BACKEND v0.2 schemas/state plus TOOLS runtime/adapter; FRONTEND viewer | A browser request generates real geometry through HTTP, then independent checks and trusted exports; the viewer shows that exact candidate. No fixture substitution. |
| M2: Feature, repair and acceptance | Pending | M1; BACKEND orchestration/CAS; TOOLS full check registry; FRONTEND review controls | Newly generated fixed tactile feature; actual failed requirement and corrected candidate; explicit acceptance packages checked bytes; stale, missing, duplicate, unknown and unevaluated evidence blocks acceptance. |
| M3: Integrated acceptance | Pending | M2; DEMO independent tests | Download hashes and reopened files match; original preserved; late completion cannot promote; timeout/cancellation and reset/repeat do not mix artifacts. Run twice from clean sessions. |
| M4: Demonstration | Pending | M3; DEMO rehearsal and BACKEND access mode | Measured timings, visible checks, working links and exact demonstrated revision. Public access is tested or footage is clearly labeled as a recording of real local execution. |

Images 2.5, consumer geometry and native steering are optional extensions and cannot block the core gates. A controller accessory needs measured attachment, neighbors and travel first; no measured stand fallback is established. A steering demo needs applied continuation evidence. Image concepts need separate requirement confirmation before CAD work. None substitutes for M2.

## Roles and exclusive paths

All six roles are active. BACKEND is the sole code integrator and publisher. PLAN owns scope and architecture; DEMO independently evaluates integrated behavior.

| Role | Exclusive paths | Responsibility |
| --- | --- | --- |
| PLAN | `docs/architecture.md`, `docs/build-plan.md`, `docs/provenance.md`, `docs/development-evidence.md` | Scope, check meaning, reference setup and documentation |
| FRONTEND | `src/client/**`, `tests/frontend/**` | Preserve landing; build workspace, viewer and review controls |
| BACKEND / integrator | `src/server/**`, `src/shared/**`, root manifests/config, `scripts/**` except the two TOOLS runtime packaging paths below, `fixtures/api/**`, `tests/backend/**`, `README.md`, CI/deployment config | Executable contracts, model orchestration, state, artifact registration and integration |
| TOOLS | `src/tools/**`, `fixtures/tools/**`, `tests/tools/**`, CAD example source, `scripts/runtime/cad.Dockerfile`, `scripts/runtime/cad-requirements.txt` | Isolated generation, independent geometry checks and trusted exports |
| DEMO | `tests/e2e/**`, `docs/demo/**` | Acceptance cases, rehearsal and honest demo evidence |
| IDEA | Product clarification notes outside the public repository | Resolve product questions without expanding the integrated scope |

TOOLS owns only `scripts/runtime/cad.Dockerfile` and `scripts/runtime/cad-requirements.txt` as an existing exception for runtime packaging; BACKEND owns all remaining scripts and integration. This ownership assignment does not assert that those files are integrated. README remains BACKEND owned. Every file has one owner; agree transfers before edits and avoid whole-repository formatting.

Use a dedicated clean worktree per role from the agreed committed baseline. Branches do not isolate runtime state: assign private ports, runtime directories and per-candidate job directories. Keep one CAD job active, and never restart another owner's server or mutate their FreeCAD session. Integrate small, independently reviewable slices through BACKEND.

All roles follow the [Astra development workflow](development-evidence.md). Substantial deliverables use the prescribed wrapper and protected acceptance checks; an already-launched worker completes its assigned work directly. Each role retains its own receipt handoff. BACKEND checks ownership, revision/fingerprint, actual verifier scope and required manual review before integration, then validates the combined revision. Development receipts do not prove product behavior or retroactively cover earlier work.

## Implementation dependencies

The following dependencies describe the implementation work pending at the cited snapshot.

1. BACKEND publishes the shared `wk-prototype-0.2` schemas, canonical encoding fixtures, candidate states and serialized requirements/acceptance rules from PLAN semantics. The draft routes observed at that snapshot were not evidence of that migration.
2. TOOLS packages the proven isolated runtime and adapter, implements the full registry and source-regeneration check, and reruns boundary probes. BACKEND reviews the packaged engine identity and integrates it.
3. FRONTEND can develop against explicitly labeled shared fixtures while TOOLS works. Connect the viewer to real registered artifacts before claiming M1; selected candidate and accepted history must remain distinct.
4. BACKEND connects Responses generation, numerical feedback and bounded repair. The model cannot change requirements or validator code. DEMO tests success, actual failure, stale completions and export identity against the same contract.

Three.js and esbuild were already wired at the cited snapshot. Any additional SDK, transport, renderer or CAD dependency must be announced and coordinated through BACKEND. Do not add a second app, CAD DSL, database or agent framework to deliver this prototype.

## One-minute demonstration

Use one `tactile_feature_v1` sequence throughout the short demonstration:

- Show the actual baseline plate and request a raised tactile feature while preserving its material and two open bores.
- Show newly generated geometry with matching dimensions and independent checks. Include real failure/repair if observed in that run; never invent an error for pacing.
- Review the corrected or first passing candidate, explicitly accept it and show the exact editable/STEP/STL package.

The longer demonstration adds the distinct `resize_centered_v1` conflict: 30 mm length produces 2 mm end material, then the user confirms 36 mm before a new checked candidate. This is a requirements change, not satisfaction of the original 30 mm request. Actual failure/repair evidence is still required for M2 even if it is not in the one-minute edit.

Record actual latency and attempts. Label sped-up or edited footage and real-run replay; never hide an unavailable live path with cached geometry. Before handoff, verify public links, repeat/reset, downloaded hashes and the exact demonstrated commit. Physical printing, supplier upload, ordering, deployment, spending and submission require applicable user authorization.

## Documentation validation

Run `python3 -B tests/docs/verify_public_docs.py` for the four public documents. It checks local links/anchors, npm script names, fences, Mermaid block structure, required terms, README length and selected privacy patterns. It does not render Mermaid, validate architectural claims, check remote-link reachability or prove runtime behavior. Source, diagram rendering and publication review remain separate.
