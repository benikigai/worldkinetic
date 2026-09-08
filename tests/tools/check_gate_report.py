"""Document/evidence consistency only; no CAD runtime is executed here."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
expected = json.loads((root / "tests/tools/engine_gate_observed.json").read_text())
report = json.loads((root / "fixtures/tools/engine-gate.json").read_text())
assert report["observation"] == expected, "Do not alter the observed measurements or provenance"
assert report["scope"] == {
    "runtimeGate": "passed",
    "applicationAdapter": "not_implemented",
    "fullAcceptanceRegistry": "not_evaluated",
    "editableSourceRegeneration": "not_evaluated",
    "physics": "not_evaluated",
    "nativeFreeCADHistory": "not_provided",
}
assert len(report["savedArtifacts"]) == 2
for actual, recorded in zip(report["savedArtifacts"], expected["artifacts"]):
    path = root / actual["path"]
    assert path.resolve().is_relative_to((root / "examples/plate/trials/engine-gate").resolve())
    assert not path.is_symlink()
    data = path.read_bytes()
    assert len(data) == recorded["bytes"] == actual["bytes"]
    assert hashlib.sha256(data).hexdigest() == recorded["sha256"] == actual["sha256"]
readme = (root / "src/tools/README.md").read_text()
for word in ("OUTSIDE_WRAPPER", "runtime_gate.py", "libGL.so.1", "-6", "0.11.1", "STL", "mm", "not_evaluated"):
    assert word in readme, "Missing required evidence distinction: " + word
assert "\u2014" not in readme
print("Gate report matches 31 recorded observations and exact STEP/STL bytes. Document consistency only; runtime observations remain OUTSIDE_WRAPPER.")
