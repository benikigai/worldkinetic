# Tool shape fixtures

`plate-v2-result.fixture.json` uses the shared v2 `ToolResult` schema. It derives
from the synthetic `fixtures/api/v2/tool-result.fixture.json`, retains fixture
provenance on the result, every check and every artifact, and recomputes the full
check bundle with `computeCheckBundleHash`. Paths are fake `/fixture-private`
locations. It is not a CAD execution, downloadable package or accepted candidate.

`engine-gate.json` and `numeric-core-trial.json` retain their earlier recorded
observations unchanged. They are distinct from this synthetic shape fixture.
