# DEMO acceptance tests

`acceptance-probe.mjs` makes five read-only HTTP checks against an agreed local instance and records responses, source hashes, branch/commit, dirty state, URL and environment. It uses Node built-ins and adds no dependencies. It never installs, starts or restarts a server and never creates a product run.

From the product directory, with a **new** evidence directory whose parent exists:

```sh
node tests/e2e/acceptance-probe.mjs http://127.0.0.1:4310 \
  '../../08_Demo-Submission/evidence/NEW-RUN-NAME'
```

Exit 0 means the five transport probes passed; it is not product acceptance. Exit 1 means an assertion failed. Exit 2 means an endpoint was unavailable or source files changed during the test. Inspect `report.json` for individual results. The probe targets provisional `wk-backend-draft-0.1`; reconcile accepted contract changes before using it on later versions.

Full acceptance is specified in `../../../../08_Demo-Submission/ACCEPTANCE.md`. Geometry changes, actual checks, visible UI states, usable downloads, invalid requests, timeouts, late results and reset/repeat need the selected contract and isolated integrated runtime. No passing fixtures substitute for those tests.

`unselected-acceptance.mjs` tests malformed requests, version/units validation and explicit scope-unavailable responses on a distinct DEMO server. It refuses port 4310 and refuses a selected design. It also checks disclosure and download integrity of the API fixture as fixture evidence only. It requires a preceding source probe report from the same instance:

```sh
node tests/e2e/unselected-acceptance.mjs http://127.0.0.1:4314 \
  '../../08_Demo-Submission/evidence/NEW-VALIDATION-RUN' \
  '../../08_Demo-Submission/evidence/NEW-RUN-NAME/report.json'
```

Re-run the read-only source probe afterward if code is being edited concurrently. Neither suite establishes a requested geometry change, real check, live model call or product reset.
