"""Packaging consistency, separate from actual image/build acceptance."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
expected = set((root / "tests/tools/runtime_packages_observed.txt").read_text().splitlines())
actual = set(line.strip() for line in (root / "scripts/runtime/cad-requirements.txt").read_text().splitlines() if line.strip() and not line.startswith("#"))
assert actual == expected, "Pin the dependencies actually observed in the selected image"
dockerfile = (root / "scripts/runtime/cad.Dockerfile").read_text()
assert "python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534" in dockerfile
assert "USER 65532:65532" in dockerfile
assert all(lib in dockerfile for lib in ("libgl1", "libglu1-mesa", "libgomp1", "cad-requirements.txt"))
print("Runtime packaging matches observed Python versions and pinned base. New Dockerfile rebuild is a separate check.")
