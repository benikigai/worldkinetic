# Astra development workflow

Each role window supervises bounded `astra.py` runs. The wrapper launches a separate Codex worker with the requested model, runs a protected acceptance command and records the outcome. It does not capture an existing desktop conversation. Reading this policy does not change the model selected in that window.

This policy governs new deliverables. Earlier work and the initial public baseline have no retroactive wrapper attribution. Work completed directly in a chat must be identified as outside the wrapper.

## All six roles

| Role argument | Task ID example | Deliverable | What establishes acceptance |
| --- | --- | --- | --- |
| `IDEA` | `IDEA-001` | Bounded product recommendation with sources and open assumptions | Document checks plus separate source and product review |
| `PLAN` | `PLAN-001` | Interface specification, acceptance criteria or dependency plan | Document checks plus review of semantics and feasibility |
| `FRONTEND` | `FRONTEND-001` | One browser interaction or viewer behavior | Relevant frontend tests and observed browser behavior |
| `BACKEND` | `BACKEND-001` | One API, state or orchestration change | Relevant server/contract tests and an actual runtime check where needed |
| `TOOLS` | `TOOLS-001` | One CAD operation, verifier or export path | Deterministic geometry/export checks against fixed requirements |
| `DEMO` | `DEMO-001` | Acceptance tests, demo script or rehearsal evidence | Appropriate test checks; scripts and recordings also need review against the demonstrated build |

Pass `--role` on every project run. Use `--artifact-kind document` for documents and `--artifact-kind code` for implementation or test code. These labels describe the deliverable. A document's `VERIFIED` record means its supplied command passed, not that its claims are true or its product decision is approved. Code checks establish only the behavior they exercise.

Research, discussion, reading, measurement, recording and status updates can happen in the supervising window. Retain their real sources and evidence separately. Send substantial file-producing tasks through the wrapper; do not launch a worker for every chat reply. This workflow does not replace the product's separate Astra/CAD runtime.

## Before starting a run

1. Read the current scope, ownership map and this workflow. State the task ID, role, exact owned paths and expected observable result.
2. Use a clean, dedicated worktree of the product repository for public product artifacts. Create role branches such as `codex/frontend` and `codex/tools` from the integrator's agreed commit. Never switch another role's active checkout. The umbrella event repository is not the product repository.
3. Keep private IDEA/research/review work in a separate private Git workspace with its own committed baseline and checks. It must have no public remote or automatic publication path. Do not copy competitor findings into a public product worktree to satisfy this protocol.
4. Agree on meaningful acceptance checks and commit them before asking the worker to implement the task. Protect the test definitions and files that define their invocation. If new tests are the deliverable, protect an existing independent runner/check contract, not the new tests being authored. Review whether new tests can actually detect the target failure.
5. If an appropriate check does not yet exist, identify that as acceptance setup work and prepare it with the owner. Do not use `true`, a file-exists check or a weakened test to manufacture successful evidence. Manual-only review remains manual-only review, with no wrapper success claimed.

IDEA and PLAN may use a product worktree for explicitly public documentation inside their ownership. Private review material stays outside. A wrapper run records the entire nonignored repository snapshot, so check its contents before choosing a public workspace.

## Invocation

The operator supplies the local development wrapper; it is currently kept outside this public product repository. Set these shell variables to real absolute paths. The test command below is a template and must be replaced with an agreed, existing acceptance command.

```bash
python3 "$ASTRA_WRAPPER_PATH" \
  FRONTEND-001 'Implement the agreed viewer behavior in the FRONTEND-owned paths.' \
  --role FRONTEND --artifact-kind code \
  --repo "$WORLDKINETICS_ROLE_WORKTREE" \
  --codex "$ASTRA_CODEX_PATH" \
  --model gpt-6-astra --effort high \
  --test '<agreed acceptance command>' \
  --protect '<committed acceptance definition>'
```

`--commit` optionally creates a local commit after verification. Without it, verified changes and the ledger remain uncommitted and must be reviewed before another run. The wrapper never pushes. Do not clear someone else's dirty tree to satisfy its preflight.

The wrapper's child receives `ASTRA_WRAPPER_RUN_ID`, its role and an explicit instruction to complete the task directly. A child must never launch another wrapper or Codex worker. The environment guard prevents accidental recursion; it is not a security boundary against generated code.

One wrapper lock covers one checkout. Other editors do not honor that lock. Use separate worktrees, ports and runtime directories. Only the assigned TOOLS operator may mutate the shared FreeCAD session. Role labels do not enforce filesystem ownership; review the actual diff.

## Handoff and integration gate

Each supervisor updates only its own existing status file. Include:

```text
Role / task ID:
Worktree / branch / base commit:
Owned files changed:
Evidence mode: WRAPPER_RUN | OUTSIDE_WRAPPER
Artifact kind: code | document
Wrapper run ID / successful attempt, or actual failure:
Requested model / reported model, if exposed:
Acceptance command / result / scope:
Commit SHA / tested-files fingerprint:
Ledger / private receipt locations:
Manual review / source or runtime evidence:
Remaining gaps:
```

BACKEND remains the sole integrator. Before accepting a wrapper-attributed change:

1. Inspect the diff for ownership, private material and changes outside the task.
2. Match the successful ledger entry, task/role, base commit and tested-files fingerprint to the delivered files. Inspect the private receipt and actual verifier output locally. With `--commit`, require the receipt's `COMMITTED` SHA to match the source commit. After a manual commit or any later edit, verify that its content still matches the tested snapshot or rerun the checks; a stale receipt is insufficient.
3. Require appropriate human/source review for IDEA, PLAN and demo claims. Preserve failed attempts and unknown provider metadata. If work was outside the wrapper, record that explicitly; do not call it wrapper-verified. The baseline and this workflow's initial setup are such exceptions.
4. Integrate small slices and run relevant checks on the combined revision. Record that integrated revision separately. A passing branch does not prove the merged application passes.

Parallel worktrees each append to their own `.astra_dev_log.jsonl`. BACKEND resolves ledger merge conflicts by preserving every distinct `(run_id, attempt)` record unchanged, removing only byte-identical duplicates. A duplicate identity with different contents requires inspection. Do not choose one branch's entire ledger and discard another role's attempts. Original branch fingerprints continue to describe their original tested trees, not the merged tree.

This is an agent operating rule and a review gate. GitHub branch protection and a CI receipt validator are not configured by this document, so direct edits and pushes are not technically blocked by it.

## What can be shown publicly

The ledger includes role, task, requested model/effort, provider-reported fields when available, timestamps, attempt outcomes, usage when reported, acceptance command, protected paths and content hashes. Exact per-attempt prompts, raw provider events, stderr, verifier logs and the commit receipt remain under the worktree's Git metadata. Locate that directory with `git rev-parse --git-path astra`.

Keep sensitive text out of task IDs and public verifier commands. Private research ledgers stay private too. A demo summary may reference sanitized run IDs, outcomes and source commits after inspection; preserve the original private evidence. Do not rewrite or fabricate an original record to sanitize it.

Requested model and provider-reported model are different fields. Null reported values remain unknown. These are local execution records, not provider-signed authorship certificates, hidden reasoning transcripts or proof of a judge score.

## Faster bounded runs

For user-authorized workflow changes, batch related same-owner, low-risk copy or cosmetics in one bounded worker with one final handoff. Do not launch a fresh worker per sentence. The existing worker may make related corrections within the assigned task. Review changed and affected files without repeatedly reviewing unchanged files. Inherited workers complete the task directly without nesting.

Use `--effort low` for simple copy. The default is medium for documents and high for code. Explicitly select high for CAD, security and shared contracts, including technical documents. An explicit `--effort` wins over defaults. Owner scope, protected checks, semantic review and BACKEND sole integration remain unchanged. Inseparable critical work still requires isolation; batching provides no bypass.

The new canonical wrapper emits a metadata heartbeat every 10 seconds by default; `--quiet-progress` suppresses it. Progress must not display raw text.

`--service-tier inherit` is the default and leaves CLI configuration unchanged. An explicit paid tier requires prior authority. Keep requested and reported service tiers separate; the actual tier remains unknown unless a completion event provides it.

Preserve old receipts unchanged and do not interrupt active workers. The parent wrapper owns verification and the ledger; workers do not rewrite evidence.
