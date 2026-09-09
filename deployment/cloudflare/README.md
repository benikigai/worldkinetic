# Invited live demo preparation

This is the same-origin API connection for the existing static website. It is not enabled by checking out or building this code. Public activation still requires the operator's access decision and a verified dedicated upstream.

The Worker serves static assets and forwards `/api` and `/api/*` to one HTTPS `API_ORIGIN`. Its `UPSTREAM_KEY` secret must match the backend's `WORLDKINETICS_UPSTREAM_KEY`. It preserves the browser Origin, session cookie, response cookies, exact download bytes and identity headers. The trusted client IP uses `X-WorldKinetics-Client-IP`, derived only from Cloudflare's `CF-Connecting-IP`. Missing configuration fails closed. API responses are never cached; upstream redirects are rejected.

## Dedicated backend

Use Node 22+, the existing locked dependencies and the TOOLS CAD runtime prerequisites. Do not reuse an accepted local runtime directory or port. The reserved preparation runtime is `.runtime/public-demo-4330`, port4330, in `codex/backend-public`. Existing4318 and4320 instances remain separate.

Supply these variables through the existing secret-management workflow, without writing credentials into this repository:

- `WORLDKINETICS_PUBLIC_ORIGIN`: exact `https://worldkinetics.app`, without a trailing slash.
- `WORLDKINETICS_UPSTREAM_KEY`: distinct random secret of at least32 characters, shared only with the Worker binding.
- `WORLDKINETICS_INVITE_CODE`: separate invitation code of1 to128 characters, selected by the operator.
- `WORLDKINETICS_PUBLIC_RUNS_USED`: carried public run count when upgrading the same demo launch. Set it from verified existing run records so an upgrade cannot replenish public allowance. Fresh launches default to0; do not restart automatically to reset budgets.
- `WORLDKINETICS_OPERATOR_CODE`: optional distinct private credential of32 to128 characters. Omit to disable operator access. Never reuse or publish the shared invitation as this credential.
- `WORLDKINETICS_OPERATOR_RUN_LIMIT`: optional operator allowance, default30, bounded1 to1000 or explicitly `unlimited`. Unlimited mode reports null limits and remaining counts only for an authenticated operator; it retains the timeout and global job lock. It applies per operator session and across all operator sessions for this launch. Operator runs use a separate pool and do not replenish or consume the public three-run pool.
- `OPENAI_API_KEY`: server-only API/project credential. Product generation uses API billing, separately from Codex login. An absent key leaves generation unavailable.
- `WORLDKINETICS_HANDLE_REFERENCE_DIR`: trusted directory containing `reference.step`, `preview.stl` and canonical `datums.json`.
- `PORT=4330` and `WORLDKINETICS_RUNTIME_DIR`: an isolated private writable directory.

After access authorization and secret provisioning, `npm run start:public` binds only loopback. Connect only that port through the approved Cloudflare tunnel. Set the Worker `API_ORIGIN` to that HTTPS upstream and configure its secret separately. Cloudflare account selection is supplied through `CLOUDFLARE_ACCOUNT_ID`; no account credentials are in this config. Build static assets with `npm run build` before using `deployment/cloudflare/wrangler.jsonc`. Deployment is an explicit operator action, never part of build/start.

## Sessions and limits

`GET /api/session` reports authentication. `POST /api/session` takes `{accessCode}`. `DELETE /api/session` signs out. All return the shared `SessionStatusSchema`. The HttpOnly, Secure, SameSite=Strict, host-only cookie lasts8hours. Every API route requires the upstream secret; other than session status/login, each also requires a valid cookie. Mutations require the exact configured public Origin.

Each browser session owns separate state, run records, references and artifacts. `POST /api/session/new` takes `{contractVersion,requestId,expectedWorkspaceId}` and creates a fresh design without replenishing runs. Repeating the same request reuses its result. Older work remains on disk but is no longer accessible through that session after reset. Sign out and restart similarly make old session artifacts inaccessible, so download before leaving a completed design.

Operator access uses the same login endpoint with the private credential. Sign out before changing between public and operator access. It grants extra run allowance only; it does not grant access to another workspace or bypass geometry checks, acceptance, the three-minute timeout, or the global CAD job lock. Remaining allowance comes from the authenticated server response.

Every child API mutation also requires `X-WorldKinetics-Workspace`, captured by the browser controller from its initial session response and preserved through the edge. After reset, old-tab mutations and exact run retries return409 instead of targeting the new workspace. Session operations use their own authentication and reset CAS body. The client reloads before using a new workspace binding.

Limits are3 runs per session,3 per process launch,20 sessions per launch,5 design workspaces per session, one globally active execution/CAD cleanup and one package preparation. A failed admitted run counts; an identical retry does not. The three-minute per-run deadline and at most3 candidate attempts remain unchanged. A cookie is not a person: clearing it can create another session, but cannot bypass the total launch cap. Invitation guesses are limited to5 per trusted IP per minute and20 globally per minute. Session identity and quotas are held in memory; restarting invalidates cookies and starts a new explicit launch budget. CAD files remain private on disk for operator review.

The supported flow is a custom initial handle, explicit acceptance, one guided distributed grip widening plus thumb-rest refinement, explicit acceptance and exact downloads. It is not unrestricted repeated editing, and checks do not verify arbitrary natural-language intent, strength or physical fit. Preparation tests use synthetic adapters; they incur no model/CAD work and do not prove public or physical readiness.

## Checks and activation gap

Run `npm run typecheck`, `npm test`, and `node --test deployment/cloudflare/worker.test.mjs`. Backend tests exercise actual loopback HTTP with synthetic provider/CAD responses: authentication, origin rejection, isolation, exact acceptance/download identity, reset retry, quotas, and cleanup admission. Proxy tests preserve custom text and download/session headers. Frontend checks and actual browser observations are recorded separately by their owner.

Before claiming public live success, verify the configured edge and dedicated runtime, then perform the separately authorized real website request, checked 3D review, explicit acceptance and matching downloads. No tunnel, public generation, provider-credit verification, or deployment is established by these offline checks.
