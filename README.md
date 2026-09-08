# WorldKinetics

**Prompt to product.**

Design and customize physical products without learning CAD.

**Repair it. Make it fit. Make it yours.**

Start with a reference or photo plus confirmed measurements. Refine, independently check, approve the exact revision, and download for prototyping or manufacturer review. Photos alone cannot establish accurate dimensions.

[worldkinetics.app](https://worldkinetics.app) is the live design preview. The public interactive demo is not yet live.

![WorldKinetics homepage with Prompt to product headline and design artwork](docs/images/worldkinetics-homepage-2026-09-08.png)

*Current prototype interface, captured September 8, 2026. Design preview, not evidence of a completed CAD workflow.*

## Recorded handle demo

Actual local workspace, September 8, 2026. Astra broadened the grip and added a thumb rest while preserving 96 mm mounting pitch and 26 mm finger clearance.

| Before: accepted handle | After: refinement under review |
| --- | --- |
| ![Initial handle](docs/images/handle-initial-2026-09-08.png) | ![Refined handle](docs/images/handle-refined-2026-09-08.png) |

Initial: eight checks passed. Refinement: nine passed, subsequently explicitly approved; downloaded STEP, STL and editable Python matched its manifest. Bounded demonstration, not physical-fit validation.

## Everyday possibilities

These are three illustrative planned workflows, not all implemented:

- **Repair a cabinet handle:** confirm mounting and fastener dimensions, then reshape the grip while preserving its interface.
- **Make a vacuum adapter fit:** measure both ends, insertion depths and clearance, then design their connection.
- **Make a tactile keyboard or control grip yours:** customize texture or shape. First measure its attachment, neighboring geometry and moving-part clearance.

![Cabinet handle illustration with sample dimensions](docs/images/cabinet-handle-sample-dimensions-v1.png)

*Sample design brief: AI-generated illustration, not a measured, manufactured or tested part. Panel clearance holes do not specify handle threads or fasteners.*

## Intended workflow

The broader intended product path:

```mermaid
flowchart TB
    R["Reference or photo + confirmed measurements"] --> D["Refine editable design"]
    D --> C["Generate CAD and seal exact geometry"]
    C --> V["Independently check requirements and exports"]
    V --> F["Measured failure: revise design or confirm new requirements"]
    F --> D
    V --> U["Review eligible candidate"]
    U --> A["Approve exact revision"]
    A --> E["Download for prototyping or manufacturer review"]
```

The model cannot change checks, lower thresholds or accept a candidate. Failed or incomplete evidence blocks acceptance. Generated, checked, accepted, exported and physically tested are separate states. Downloads preserve checked bytes and revision identity.

## Why WorldKinetics?

**More than a model. A design you can check.**

Astra proposes designs. WorldKinetics is building toward a guided, checkable workflow around those proposals:

- **Keep what fits:** preserve confirmed measurements and requirements.
- **See what changed:** review targeted edits in a before-and-after comparison.
- **Check before you make:** review independent checks, approve the exact revision, and export its checked files.

The intended experience extends beyond the bounded demonstrations recorded here.

## Current evidence and limits

Earlier numeric plate evidence: [`0311706879b29810cb4bca56ece32a10bdea294e`](https://github.com/benikigai/worldkinetic/commit/0311706879b29810cb4bca56ece32a10bdea294e), September 8, 2026, around 14:00 PDT:

- A local API run used actual `gpt-6-astra` Responses numeric planning plus real CAD. This was not model-authored Python.
- A 30 mm plate was rejected because its measured 2 mm end margin fell below the unchanged 5 mm requirement.
- After confirming a 36 mm requirement, the new candidate passed seven required checks with a 5 mm end margin. This did not satisfy the original 30 mm request.
- API acceptance and exact source, editable Python, STEP and STL downloads were verified in that local run.

The plate evidence is local API evidence, not browser or physical fit proof. Arbitrary-product CAD and public interactive access remain unverified. Neither demonstration establishes strength, printing, simulation or manufacturing certification. Supplier upload, ordering, fabrication and submission require separate authorization.

## Run locally

Requires Node.js 22 or newer:

```sh
npm ci
npm run build
npm start
```

Open [localhost:4310](http://127.0.0.1:4310) for the local design preview. `/api/bootstrap` reports configured scope and readiness. The current server selects the plate baseline; numeric execution also requires a server-side `OPENAI_API_KEY`, Python 3.9+, Docker and the expected local CAD image. See [CAD runtime prerequisites and limits](src/tools/README.md). The npm commands do not provision that image.

```sh
npm run typecheck
npm test
```

`npm test` exercises backend behavior with synthetic adapters and provider responses; it does not establish the complete CAD or browser workflow. `npm run dev` watches server changes; rebuild static assets with `npm run build`.

Use a private `PORT` and `WORLDKINETICS_RUNTIME_DIR` for each development instance. [.env.example](.env.example) lists settings; export variables in your shell because the server does not automatically load `.env`. Keep credentials and raw provider/runtime logs private.

## Historical snapshot and documentation

The older snapshot at `4090c8166a2e52eb3e16e094d42c7bd1423407a8`, September 8, 2026, around 13:14 PDT, contained a tested scaffold and separate local capability proofs. Integrated CAD, workspace review and explicit acceptance were pending at that time. Those historical statuses do not describe the newer owner-reported run above.

- [Architecture and diagrams](docs/architecture.md): intended trust boundaries, requirements and acceptance.
- [Build plan](docs/build-plan.md): milestones and [contributor ownership](docs/build-plan.md#roles-and-exclusive-paths).
- [Backend scaffold](docs/backend-scaffold.md): transport and adapter notes with historical planning statuses.
- [Plate examples](examples/plate/README.md): preserved FreeCAD files, STEP/STL exports and sanitized measurements.
- [Provenance and historical evidence](docs/provenance.md#evidence-snapshot): attribution and revision-specific limits.

Document checks cover structure and links, not factual or runtime claims; source and product review remain separate.

Project source is [MIT licensed](LICENSE). External dependencies and services retain their own terms.
