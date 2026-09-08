# DEMO acceptance tests

The v0.2 suite tests additive shared-contract helpers using synthetic fixtures. It uses Node built-ins, `node:test`, strict assertions and the existing `tsx` loader. It makes no provider/CAD/HTTP calls, executes no proposal Python, starts no service/container and adds no dependencies. Run from the repository root with installed dependencies:

```sh
node --import tsx --test --test-reporter=tap tests/e2e/contracts-v2.acceptance.test.mjs
node tests/e2e/verify-invariant-tests.mjs
```

The first command runs direct conformance tests. The second is the protected wrapper acceptance command. It copies the shared source, public fixtures and E2E files into disposable local evidence directories, links existing dependencies and runs healthy controls plus the suite against baseline and 13 specific guard-removal mutations. It requires all 21 bracketed cases, a passing baseline, no skips/todos/cancellations and each mutation to fail its designated test. It never edits the original source or fixture files. Do not change this protected runner to accommodate a failing test.

The runner prints the evidence directory and writes `report.json`, per-copy `control.log` and `suite.tap` under `.runtime/demo-test-quality/run-*`. A successful report establishes test sensitivity to those 13 faults only. Exit 0 is not live product acceptance, CAD validation, authenticated action proof or a recording. The parent wrapper owns run receipts and ledger evidence; the protected runner was prior acceptance setup.

See [acceptance-cases.md](../../docs/demo/acceptance-cases.md) for the automated coverage and **NOT_RUN** integration/state/geometry/browser matrix. Parsing a fixture as reviewable cannot make it eligible for live acceptance. Async integrity checks must verify requirements, bundles and dispatched input bindings. The current v0.2 release has no migrated HTTP/store/CAS implementation. Live acceptance, recording and physical claims remain **NOT_ESTABLISHED**.

## Legacy v0.1 probes

`acceptance-probe.mjs` and `unselected-acceptance.mjs` remain unchanged and explicitly legacy until transport migration. They target `wk-backend-draft-0.1`; their assertions must not be weakened or relabeled as v0.2 coverage. Neither was run for the shared-contract deliverable.

`acceptance-probe.mjs` makes five read-only HTTP checks against an agreed local instance and records responses, source hashes, branch/commit, dirty state, URL and environment. It uses Node built-ins, never installs/starts/restarts a server and never creates a product run. With a new evidence directory whose parent exists:

```sh
node tests/e2e/acceptance-probe.mjs http://127.0.0.1:4310 \
  '../../08_Demo-Submission/evidence/NEW-RUN-NAME'
```

Exit 0 means five transport probes passed. Exit 1 means an assertion failed. Exit 2 means an endpoint was unavailable or source files changed during the test. Inspect `report.json` for individual results. These are legacy transport results, not product acceptance.

`unselected-acceptance.mjs` tests malformed requests, version/units validation and explicit scope-unavailable responses on a distinct DEMO server. It refuses port 4310 and a selected design. It also checks disclosure and download integrity of the API fixture as fixture evidence only. It requires a preceding source probe report from the same instance:

```sh
node tests/e2e/unselected-acceptance.mjs http://127.0.0.1:4314 \
  '../../08_Demo-Submission/evidence/NEW-VALIDATION-RUN' \
  '../../08_Demo-Submission/evidence/NEW-RUN-NAME/report.json'
```

Re-run the read-only source probe afterward if code is being edited concurrently. These probes do not establish geometry changes, real engineering checks, live model calls or product reset.
