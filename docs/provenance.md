# Prototype provenance

WorldKinetics is an early open-source prototype developed for the September 8, 2026 Astra hackathon. The repository distinguishes working code, separate CAD experiments and proposed features.

## Original contribution

- The TypeScript request, run-state and artifact scaffold, its tests, and the original Frost/Graphite/Canvas placeholder assets were created for this prototype.
- The included FreeCAD plate and its separate resized revision were generated during the event. Their saved verification results establish geometry and export checks, not an integrated application or a physical fit test.
- The proposed next contribution is the conversational generation/inspection/repair workflow, independent protected checks, explicit revision acceptance and changed-requirement handling. These remain planned until demonstrated by code and evidence.

Commit times record repository publication, not proof of when every line was authored. Preserve actual development receipts and identify the exact demonstrated commit. Do not attribute features to the hackathon build before they work.

## Dependencies and attribution

- Current application dependencies are listed in `package.json` and pinned in `package-lock.json`; their licenses remain their own.
- FreeCAD is the external CAD application used for the included experiment. It is not vendored here. [FreeCAD](https://www.freecad.org/).
- The local experiment used the existing MIT-licensed `CREATeNG/freecad-mcp-bridge`, reviewed at commit `5a4ecdde8492a315d8de4fe8aa08e579484cba60`. The bridge implementation is not WorldKinetics' original work and is not copied into this repository. [Bridge source](https://github.com/CREATeNG/freecad-mcp-bridge).
- build123d is the proposed worker dependency, not installed or runtime-verified by the planning work. Add its exact version and dependency/license inventory when the runtime gate passes. [build123d](https://github.com/gumyr/build123d).
- GPT-6 Astra provides model reasoning/generation through the selected provider. Record requested and reported model identities separately when a runtime does not expose both.

The prototype's own source is MIT-licensed. Dependency software, provider services and externally supplied reference assets retain their own terms. No external reference asset should be included without recorded provenance and reuse rights.

## Evidence status

At baseline publication, type checking, 45 backend tests and the static build passed. Most backend tests use synthetic adapters or a fake provider process; they do not prove real CAD generation or live API steering. A separate owner-reported constrained CLI provider probe and the included real FreeCAD trial are different evidence paths.

The checked plate revision is 50 x 35 x 5 mm, with two 6 mm through-holes centered 20 mm apart. Its original is preserved. Native FreeCAD and STEP reopening and STL integrity were tested. See `examples/plate/verification.json` for the sanitized experiment results and hashes.

No live product CAD interaction, isolated generated-code worker, physical printing/fit, supplier quote, manufacturing approval or structural analysis is established by these examples. The public placeholder is a design preview.

## Publication boundary

This repository contains product source, build documentation, tests and owned CAD examples. Keep private research, competitor assessments, model-review packets, credentials, local runtime output and private provider logs outside it. Only deliberately sanitized evidence belongs in public examples or demo material.
