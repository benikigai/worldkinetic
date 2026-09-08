# Synthetic handle flow

`handle-flow.fixture.json` is a SYNTHETIC transport fixture for `handle_fixture`, with `executionEvidence: "NOT_RUN"`. All runs, candidates, checks and artifacts use `executionMode: "fixture"`; the engine is `fixture`. Measurements, passage flags, user actions, acceptance records and timestamps are invented example data. They provide no actual acceptance proof, CAD evidence or product authority.

| Consumer state | Selected candidate | Accepted revision | Active requirements match | State version |
| --- | --- | --- | --- | --- |
| `initialAccepted` | Initial, eight checks, reviewable | Initial | true, version 1 | 8 |
| `refinementReviewable` | Refined, nine checks, reviewable | Initial | false, version 2 | 10 |
| `finalAccepted` | Same refined candidate, unchanged | Refined | true, version 2 | 11 |

Each state contains `{ bootstrap, history }` using existing transport contracts. API routes, schemas, acceptance rules and runtime behavior are unchanged. Consumers should keep selected reviewable geometry separate from accepted history. An acceptance is a separate record; it does not change the candidate's `reviewable` status.

The first synthetic acceptance compares state version 7 and a null previous acceptance, then records version 8. The refinement snapshot represents requirements changing at version 9 and refined candidate selection at version 10. The second synthetic acceptance explicitly compares state version 10 and the initial accepted revision, then records version 11. Both requests contain distinct fixture user-action IDs and exact requirements, geometry and check-bundle bindings. No API request or actual user approval produced these records.

Requirements version 2 binds the exact first acceptance ID, initial revision, STEP artifact ID/hash, requirements ID/version, setup hash, source hash and check-bundle hash. The original `handle_mount_reference_v1` remains the independent mount reference. Its hash is derived from a fixed synthetic identity string, differs from the initial STEP hash and does not identify actual reference bytes. No reference files or image inputs are supplied. Frozen registry descriptions such as `actual_accepted_initial_STEP` retain their contract wording; their presence here is not an actual-CAD claim.

The initial acceptance and its manifest remain byte-semantically identical in both later histories, including their version 1 requirements and candidate evidence. The refined candidate remains identical between review and final acceptance. Each manifest contains all six candidate artifact descriptors and matching requirements, checks, engine, source, proposal, geometry and check-bundle identities; its hash covers the canonical payload excluding `manifestHash`.

Artifact hrefs illustrate ID-based transport shape only. They do not advertise available downloads. STEP and STL descriptors hash nonexistent, invalid-format synthetic text, not usable geometry. Source and editable descriptors hash the same comment-only string, which generates nothing. Requirements and check descriptors hash canonical JSON held in memory. The engine digest identifies a synthetic string, not a container image. Nothing is registered, reopened, exported, physically tested or approved by the product.

Regenerate only this JSON fixture from the repository root:

```sh
node --import tsx fixtures/api/v2/generate-handle-flow.ts
```

The helper has fixed IDs, timestamps and synthetic values. It uses shared canonical constructors and frozen check definitions for methods, units and expectations, then computes source/proposal, artifact, check-bundle and manifest hashes. It writes only `handle-flow.fixture.json`, never geometries or existing fixtures. It does not call CAD, providers, APIs or another worker. No dependencies are added.

The protected verification command is:

```sh
node --import tsx --test tests/backend/*.test.ts && node --import tsx scripts/build.ts
```

This includes `handle-flow-fixture.test.ts` and the existing backend suite. Passing these checks establishes transport consistency and build success only. Whole-app type correctness is not claimed; the frontend requirements-union migration remains separate. Live handle generation, authenticated acceptance, download availability, independent geometric checks and physical fit remain outside this fixture's evidence. The parent wrapper owns its verification receipt and execution ledger.
