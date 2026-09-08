# Prototype build plan

Draft for review, September 8, 2026. Product direction is committed; runtime, consumer reference and live capability gates below still require evidence. This plan does not dispatch agents or mark the product integrated.

## Success

A user describes an adaptation, Astra generates real editable geometry, independent checks find a conflict, Astra repairs it, and the user accepts and downloads the exact checked revision. The screen shows a visible change, actual measurements and honest status. A mid-work requirement change demonstrates steering and correct treatment of older results if that API experiment succeeds.

The plate is the first integration reference. The primary consumer story is a tactile controller key, conditional on measured attachment/neighbor/travel geometry. A stand fallback requires an actual measured reference and a recorded user decision; no measured stand package was found in the project files inspected during fleet planning. Do not spend the entire day solving unknown mechanics or replace the consumer story with a plate without saying so.

## Critical path and timeboxes

The captured event deadline is 5:30 PM PDT, with a one-minute video. Work toward a 4:30 PM reliable build and 5:00 PM freeze. These are planning targets for the remaining day, not a fresh full-day schedule. Recalculate the early milestones when review finishes; protect the final recording/submission buffer.

| Milestone | Target PDT | Evidence required |
| --- | --- | --- |
| M0: Resolve execution, reference and provider gates | 12:45 PM | 20-minute isolated CAD smoke test; API/image/steering capability receipts; measured consumer-reference decision or explicitly pending choice |
| M1: One integrated plate revision | 1:30 PM | Browser request -> real candidate -> independent checks -> explicit acceptance -> reopened exports |
| M2: Creative geometry and repair | 2:30 PM | A new feature beyond a prebuilt parameter edit; one failed fixed requirement and one corrected measured candidate |
| M3: Consumer flow and changed requirement | 3:30 PM | Grounded accessory in the viewer, meaningful protected geometry, correction while pending, stale evidence rejected |
| M4: Rehearsal and demo access | 4:30 PM | Repeat/reset succeeds; public demo access mode tested; clean repository, evidence and one-minute script ready |
| Freeze and recording | 5:00 PM | No new features; exact demonstrated build recorded and artifact links checked |
| Submission deadline | 5:30 PM | Required public repository, accessible demo, video and roster prepared/submitted only under the user's authorization |

Native steering and isolation probes start before UI polish. Do not wait for every gate to let FRONTEND work against labeled fixtures and DEMO write acceptance cases. If M1 slips, cut optional features immediately. If M2 fails, do not spend M3 pretending a preset parameter editor demonstrates open-ended design.

## Roles and exclusive paths

Use the existing tasks. BUILD BACKEND is the sole code integrator; a separate integrator task would add another handoff at this size. PLAN owns scope and interface meaning. DEMO independently checks integrated behavior.

| Role | Owned paths | First bounded deliverable |
| --- | --- | --- |
| PLAN | `docs/architecture.md`, `docs/build-plan.md`, `docs/provenance.md`, `docs/development-evidence.md`; private planning/review artifacts outside this repository | Resolve named checks, reference identity, worker boundary and semantic migration |
| BUILD FRONTEND | `src/client/**`, `tests/frontend/**` | Separate workspace, real mesh viewer, before/after, current checks and candidate acceptance controls |
| BUILD BACKEND / integrator | `src/server/**`, `src/shared/**`, root manifests/config, `scripts/**`, `fixtures/api/**`, `tests/backend/**`, `README.md`, CI/deployment config | Publish `wk-prototype-0.2` schemas/fixtures, acceptance state and one connected tool operation |
| TOOLS | `src/tools/**`, `fixtures/tools/**`, `tests/tools/**`, CAD example source | Isolated engine smoke test and independent geometry/clearance/export verification |
| DEMO | `tests/e2e/**`, `docs/demo/**` | Executable success/failure/stale-result cases and a recorded evidence checklist |
| IDEA | Product clarification notes outside this repository | Resolve requested product questions; do not expand features during integration |

The initial repository publication may add the planning docs and CAD example package. After that baseline, routine changes return to the owners above. Root README/config edits go through BACKEND. Every file has one owner; any transfer is explicit. No agent performs whole-repository formatting or edits another role's feature to make an integration test pass.

Keep integration on BACKEND's controlled checkout. Once a committed baseline exists, use separate branches/worktrees for independent implementation and integrate small slices. Shared runtime state is not isolated by a branch: use port/runtime pairs 4310 + `.runtime/backend-4310`, 4311 + `.runtime/frontend-4311`, and 4313 + `.runtime/demo-4313`. TOOLS needs no listening port; allocate a private job directory per candidate. Only the assigned tool operator controls the existing FreeCAD session.

All six roles follow the [Astra development workflow](development-evidence.md). Each window supervises bounded wrapper runs, retains its own handoff evidence and respects separate worktrees. BACKEND reviews branch evidence before integration and records checks on the combined revision separately. This is a development process, not proof that the product runtime works or that previous chats were captured.

## Dependency-aware tasks

| ID | Owner | Task | Dependency | Done evidence |
| --- | --- | --- | --- | --- |
| P1 | PLAN | Publish v0.2 semantics, exact plate baseline and required check set | This review | Owners can implement without inventing acceptance rules |
| T1 | TOOLS | Prove isolated build123d generation, STEP import and exports on actual host | P1 | Exact plate geometry/volume; host/reference/network boundary probes pass; image digest recorded |
| B1 | BACKEND | Probe Responses text/image input and selected async/steering flow | Existing authentication metadata; intended event API access | Actual response IDs/events and clear supported/unavailable outcome; no secret values logged |
| B2 | BACKEND | Separate candidate completion from human acceptance; migrate schema/fixtures | P1 | Failed/unknown checks block acceptance; obsolete evidence returns 409; old retries retain identity |
| F1 | FRONTEND | Build workspace against B2's labeled fixtures | Draft fixture | Viewer, failed-region evidence, selected versus accepted state and errors rendered correctly |
| D1 | DEMO | Write success, failure, stale and original-preservation cases | P1/B2 contract | Cases identify observable inputs/results and needed fixtures without weakening requirements |
| T2 | TOOLS | Implement generator/verifier/preview interfaces and export package | T1 | Real candidate with trusted checks and reopened outputs; no self-reported pass accepted |
| B3 | BACKEND | Connect one request to T2, artifact registration and acceptance | B2/T2 | One passing M1 run through actual HTTP, no fixture substitution |
| F2 | FRONTEND | Replace fixture source with live B3; render/capture actual model for feedback | F1/B3 | Screenshot and dimensions match the selected revision; original remains accessible |
| B4 | BACKEND | Add bounded candidate/feedback loop and API steering when B1 passes | B1/B3/F2 | New feature and actual repair; late responses cannot accept an obsolete design |
| T3 | TOOLS + PLAN | Ground consumer reference and check its attachment/clearance/process profile | Reference gate | Sources, measurements, tolerances and supported checks are explicit |
| D2 | DEMO | Run full acceptance, repeat/reset and one-minute rehearsal | B4/F2/T3 | Actual artifact hashes, measurements, attempt timings and visible failure/recovery |
| B5 | BACKEND | Provide a tested demo access mode and documented launch/reset | M1; hosting decision | HTTPS live workspace or clearly labeled real-run replay; local live demo remains reproducible |

No new dependencies are installed by this plan. Anticipated additions are the OpenAI SDK/WebSocket transport for the product API path, Three.js for geometry display, a trusted browser renderer if needed, and pinned build123d dependencies in the worker image. Each owner requests additions through BACKEND; omit any dependency whose selected feature is cut.

## What earns technicality evidence

| Rubric, 25% each | Demonstrable contribution | Evidence to retain |
| --- | --- | --- |
| Astra used during development | A concrete feature or bug developed with Astra, independently checked | Original task, meaningful code diff, actual failed/passed verification, available model/usage metadata |
| Astra central to product | Generated CAD, interpretation of tool/image feedback, measured repair and live requirement update | Prompts, public tool actions, candidate source diffs, checks and API events |
| Live demo | Familiar object changes visibly; a real conflict leads to a useful alternative | One-minute recording; clear first result; consistent before/after views and a complete handoff |
| Technicality | Isolated generation, independent verification, revision-correct acceptance and export integrity | Boundary tests, numerical checks, stale-result test, reopened CAD and reproducible run |

These are evidence targets, not predicted scores. A larger integration count or extra simulation does not establish a stronger product. Judge-facing explanations should connect each technical component to the result it makes trustworthy or useful.

## One-minute narrative

- 0-8 seconds: show the actual controller/accessory and the request: make the command key easier to find by touch.
- 8-22 seconds: show a real generated candidate and its protected attachment, with a concise explanation of what changed.
- 22-40 seconds: request a conflicting change; show the measured failure, then Astra's alternative. If demonstrating pending-work steering, retain the actual event timing and show obsolete work as obsolete.
- 40-52 seconds: show the corrected candidate, matching measurements and explicit acceptance.
- 52-60 seconds: show the editable/export package and one concise statement of the event-built contribution.

The sequence may require an edited recording of a longer real run. Do not fabricate progress, conceal a failed live path with fixture geometry or misrepresent sped-up footage as latency. A three-minute live script includes reset and failure recovery. DEMO refines pacing after measuring the loop.

## Freeze checklist

Run the same task from a clean design session twice; reopen downloads; exercise a known failure and late completion; verify the public repository contains only relevant product material; identify event-built code versus dependencies; check the actual demo/video links. Record runtime versions, baseline hash and the demonstrated commit. Keep credentials and private execution logs out of the public package. Final submission and any new hosting costs require the user's applicable authorization.
