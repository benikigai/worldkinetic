# Working on WorldKinetics

This is a prototype. Read `README.md`, `docs/architecture.md` and `docs/build-plan.md` before implementation. The architecture describes planned behavior; inspect the source and current runtime before claiming it works.

## Current sprint override, September 8, 2026

The user approved direct coding for the remaining hackathon sprint. This supersedes the mandatory wrapper workflow below. Work directly in the assigned role worktree; do not launch another wrapper or child builder for new work. Let already active workers finish safely without concurrent edits or changes to their protected acceptance inputs.

Keep the wrapper and all existing receipts and ledger entries. Record subsequent direct work as `OUTSIDE_WRAPPER`, with exact commits, focused actual checks and remaining gaps. Earlier wrapper attribution applies only to its recorded snapshot. Preserve file ownership, the shared CAD lock, frozen handle requirements and BACKEND as sole integrator. Do not change models, service tiers or dependencies for this workflow override.

Prioritize actual cabinet-handle generation, explicit initial acceptance, grip and thumb-rest refinement, current checks, explicit final acceptance and matching downloads. The product still uses real Astra calls. The wrapper instructions below are historical unless the user explicitly requests another wrapper run.

**Earlier wrapper policy, retained for historical context:**

All six role supervisors must also read `docs/development-evidence.md`. Route new substantial file-producing tasks through the local `astra.py` with an explicit `--role`, appropriate acceptance checks and a dedicated clean worktree. Retain the run evidence in the role's own status handoff. If `ASTRA_WRAPPER_RUN_ID` is set, you are already its worker: do the assigned task directly and never launch a nested wrapper or Codex worker. Document checks do not replace source or product review. Identify acceptance setup, manual-only work and earlier changes as outside the wrapper; never fabricate or backdate a receipt. BACKEND checks evidence before integration.

- PLAN owns scope and architecture documentation. BACKEND owns executable contracts, root configuration, server code and integration. FRONTEND owns `src/client/**`. TOOLS owns `src/tools/**` and geometry fixtures/tests. DEMO owns `tests/e2e/**` and `docs/demo/**`. See the exact ownership table in the build plan.
- Preserve the existing placeholder's layout, artwork, typography and theme options. Develop the CAD workspace separately.
- One owner per file. Use separate worktrees after the committed baseline when parallel work would overlap. Use private ports and runtime directories even across branches. Do not restart another owner's server or mutate their FreeCAD session.
- Keep changes small and use the existing TypeScript/Python conventions. Do not create a second app, CAD DSL, agent framework or database without a demonstrated need.
- Announce dependency additions. Never commit credentials, `.env` values, runtime/provider logs, private research or competitor findings. Use the operator's existing secret-management workflow.
- Generated code cannot alter requirements, checks or acceptance. Candidate execution and verification must have separate authority and files. A bare subprocess or a loopback MCP bridge is not isolation.
- Distinguish generated, checked, accepted, exported and physically tested states. Tie evidence and files to exact revisions and requirements. Never substitute fixture output silently.
- Keep original source and CAD intact. Explain failures with actual measurements. Do not weaken tests or requirements to obtain a pass.
- Run checks appropriate to the change. Report what changed, what was verified and remaining gaps. `npm test` currently covers the scaffold, not a complete CAD product.
- Do not deploy, upload to suppliers, order, print, spend or submit without applicable user authorization. Publishing the initial repository does not authorize those separate actions.
- Write plainly. No em dashes, emoji or claims of production readiness without evidence.
