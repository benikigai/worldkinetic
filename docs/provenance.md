# Prototype provenance

WorldKinetics is an early prototype developed for the September 8, 2026 Astra hackathon. The public repository is [benikigai/worldkinetic](https://github.com/benikigai/worldkinetic). The root site is a design preview; a working CAD product demo is not established by repository publication.

## Original work and external components

Event work includes the TypeScript HTTP/run/artifact scaffold and tests, the original landing design and theme assets, and generated FreeCAD plate examples. The [plate README](../examples/plate/README.md), [generation script](../examples/plate/create_original.py) and [sanitized measurements](../examples/plate/verification.json) identify the example work and its limits. The [approved brand assets](../src/client/brand/README.md) are separate from any image-generation experiment.

The proposed conversational generation/repair workflow, protected checks and explicit revision acceptance remain integration work. Do not attribute a planned feature to a demonstrated build. Commit/publication timestamps do not establish when every line was authored.

| External component | Attribution and use |
| --- | --- |
| Node.js, TypeScript, Zod, tsx | Existing scaffold/build tools; see [package.json](../package.json) and [lockfile](../package-lock.json) for declared and resolved dependencies. |
| Three.js 0.186.0 and esbuild 0.28.2 | Integrated viewer dependency and bundle wiring; a functional viewer is pending. [Three.js](https://threejs.org/docs/), [esbuild](https://esbuild.github.io/). |
| FreeCAD 1.1.3 | External CAD application used for the native examples. [FreeCAD](https://www.freecad.org/). |
| CREATeNG/freecad-mcp-bridge | External bridge used in the local FreeCAD experiment, reviewed at commit `5a4ecdde8492a315d8de4fe8aa08e579484cba60`; not copied into this project. [Bridge source](https://github.com/CREATeNG/freecad-mcp-bridge). |
| build123d 0.11.1 and cadquery-ocp-novtk 7.9.3.1.1 | Separate local arm64 CAD runtime proof; product packaging pending. [build123d source](https://github.com/gumyr/build123d), [import/export documentation](https://build123d.readthedocs.io/en/stable/import_export.html). |
| GPT-6 Astra | External model selected for product reasoning and Python generation through Responses API. [Official model guide](https://developers.openai.com/api/docs/guides/latest-model). |
| Images 2.5 | Optional proposed `gpt-image-2.5-flare` visual-intent path. [Official image guide](https://developers.openai.com/api/docs/guides/image-generation), [launch](https://openai.com/index/introducing-chatgpt-images-2-5/). |

The project's public source is [MIT licensed](../LICENSE). External dependencies, services and supplied assets retain their own licenses and terms. Record provenance and reuse rights before including external reference geometry. No new dependency or license inventory is implied by this documentation update.

## Evidence snapshot

Snapshot dated September 8, 2026. The integrated code reference is [`4090c8166a2e52eb3e16e094d42c7bd1423407a8`](https://github.com/benikigai/worldkinetic/commit/4090c8166a2e52eb3e16e094d42c7bd1423407a8), around 13:14 PDT. Local capability outcomes below were reported separately that day; their precise times are not asserted. This document update inspected source and public example evidence, but did not rerun those capability experiments.

| Evidence path | Observed result and scope | What it does not establish |
| --- | --- | --- |
| Integrated scaffold at the cited revision | BACKEND reported 47 backend/static tests, typecheck/build and 14 ephemeral HTTP asset checks passed. [Backend tests](../tests/backend) exercise schemas, state, synthetic adapters/provider processes and serving. | Full CAD workflow, browser interaction or deployed state. The existing long-running port 4310 listener was not reloaded for that evidence. Test counts describe this revision only. |
| Historical numeric CLI probe | Requested `gpt-6-astra`; constrained response completed through a compatible Codex CLI. Reported model identity is unknown. [Probe source](../scripts/verify-astra.ts), [provider adapter](../src/server/astra.ts). | Responses API access, Python generation, CAD execution, native steering or image generation. |
| Separate one-shot Responses API probe | Access passed on the development host with requested and reported `gpt-6-astra`. | Integrated API orchestration, generation/repair, applied native steering or image generation. |
| Separate build123d isolation gate | Real plate generated, generator stopped, sealed STEP reopened in a fresh trusted verifier: 50 x 35 x 5 mm, one valid solid, volume 8467.25666117691 mm3, empty nominal bore keepouts. STL byte layout, bounds and volume checked. Non-root, network, root/reference/host-access and process-timeout probes passed. | Complete product check registry, integrated adapter, public reproducible runtime image, new FCStd history or physical testing. |
| Preserved FreeCAD examples | Public verification timestamp `20260908T184754410753Z`; native and STEP reopening, STL integrity, original hash unchanged. Revised plate volume 8467.256661176916 mm3. [Measurements and hashes](../examples/plate/verification.json). | Product API execution, strength, printing or fit. The portable script path adaptation was syntax-checked, not separately rerun. |
| Separate frontend image experiment | Provider reported Images 2.5/Flare for a standalone marketing visual experiment. | Product direct API integration, checked CAD, measured dimensions or replacement of the approved SVG logo. |

The local CAD capability image identity was `sha256:bba502dc5c3fb943c078cdcb5c0a4b9faa321839ceb59bcfd5c41c33cbe0c440`. This identifies the reported local proof; it is not a published image address or a complete reproduction recipe.

Current executable transport is `wk-backend-draft-0.1`. PLAN-01 semantics are released, but BACKEND's `wk-prototype-0.2` schemas/state, real CAD adapter, functional workspace viewer and integrated DEMO acceptance remain pending. The [architecture](architecture.md) states the target requirements without claiming they are active.

## Development evidence versus product evidence

The [Astra development workflow](development-evidence.md) governs bounded development tasks and protected checks. Its wrapper launches a development worker; it is separate from the product's model/CAD runtime. Requested and reported models are distinct fields, and unavailable reported identities stay unknown. Earlier work and manual acceptance setup are not retroactively wrapper-attributed. Receipts are execution evidence, not provider-signed authorship certificates.

The protected public documentation checker covers links, anchors, script names, structure, required terms and selected privacy patterns. A pass is not source-truth verification, Mermaid rendering or a product runtime test. BACKEND must separately review claims, diagrams and the combined revision before publication.

## Publication and remaining gaps

Private review/research, competitor findings, credentials and raw provider/runtime receipts remain outside the public product. Public examples contain only deliberately sanitized evidence. The public repository documents the proposed local workflow and owned reference files without exposing private source paths.

Generated, checked, accepted, exported and physically tested are different states. Complete runtime packaging, integrated repair/acceptance, consumer attachment and travel measurements, printing, physical fit, strength, simulation, supplier handoff and public live CAD hosting remain unverified. A static site or a recording cannot establish live CAD access. No supplier upload, order, fabrication or submission is implied by this publication.
