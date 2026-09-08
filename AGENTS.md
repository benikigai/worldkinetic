# Working on WorldKinetics

This is a prototype. Read `README.md`, `docs/architecture.md` and `docs/build-plan.md` before implementation. The architecture describes planned behavior; inspect the source and current runtime before claiming it works.

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
