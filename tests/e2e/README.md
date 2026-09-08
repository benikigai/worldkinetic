# DEMO acceptance tests

## DEMO-02-STATE software HTTP/state coverage

This additive section covers the adopted BACKEND state/HTTP release `9411ae57776fd45d3824a25d015b69e7f75adc7c`. The earlier shared-contract and legacy sections below retain their original evidence and IDs. Their statements about an unmigrated server describe that earlier release, not this state/HTTP baseline.

[state-http.acceptance.test.mjs](state-http.acceptance.test.mjs) exercises the actual `RunStore`, artifact registration and `createApp` with isolated temporary directories and ephemeral `127.0.0.1` ports. Candidate preparation is an injected generation boundary through the store. All source/STEP/STL bytes and measured fields are explicitly synthetic/no CAD. The contract's `live` enum and `build123d` engine name exercise software eligibility with a labeled test-double version; they do not attest to CAD execution, a real image or a provider call. No generated source executes. Only test-owned servers and directories are closed or removed, and no dependencies are added.

Reproduce the protected check from the repository root:

```sh
node tests/e2e/verify-state-http-tests.mjs
```

The independent runner invokes `node --import tsx --test --test-reporter=tap tests/e2e/state-http.acceptance.test.mjs` in disposable copies. It requires all 18 named cases to pass on baseline without skips, todos or cancellations, and each of 14 deliberately altered copies to fail its designated case while independent healthy controls pass. It writes a fingerprint, `report.json`, `control.log` and `suite.tap` under `.runtime/demo-state-http-quality/run-*`. The runner is protected acceptance setup; the parent wrapper owns execution receipts, verification and commits. A result applies to the exact suite fingerprint and source copy tested.

Coverage includes explicit software acceptance, manifest joins, exact synthetic download bytes and headers, selection/CAS races, canonical retries, persistent history/events, tampering, HTTP body parsing, superseded completion, interrupted restart and two clean sessions. Requirement changes block current export, including a same-ID export retry; historical acceptance and downloads remain readable with historical applicability. Current HTTP parsing errors expose safe `INVALID_REQUEST` bodies with status 400 or 413, and corrupt downloads expose status 500 with `EXECUTION_FAILED`.

These are real software HTTP/state tests with injected synthetic generation. The contract helper tests below remain a separate evidence tier. Owner-reported CAD checks in [provenance](../../docs/provenance.md#evidence-snapshot) remain separate and were not rerun here. Full provider-to-CAD-to-browser acceptance, usable CAD downloads, rehearsal, recording and physical tests remain **NOT_RUN** for this task. See the additive case map in [acceptance-cases.md](../../docs/demo/acceptance-cases.md#demo-02-state-software-evidence).

## Earlier shared-contract evidence

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
