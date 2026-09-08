"""Protected TOOLS-02 integration acceptance for the numeric CAD core.

Bootstrapped OUTSIDE_WRAPPER before implementation. These are synthetic fixture
requests; no user acceptance or application transport is simulated as live.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / ".runtime/tools/acceptance" / uuid.uuid4().hex
RUN.mkdir(parents=True)
REFERENCE = ROOT / "examples/plate/revised/plate-50x35x5.step"
REF_HASH = "9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3"
REQUIRED = {"geometry.valid_single_solid", "geometry.requested_dimensions", "holes.layout", "margin.end_material", "export.step_reopen", "export.stl_reopen", "export.editable_reopen"}
PRESERVE = {
    "examples/plate/original/mcp-test-plate.FCStd": "ad0fcb3e58f6f0fd7405c9d42b01901a2f31e299322bb84b3e92fe4b7a012bfc",
    "examples/plate/revised/plate-50x35x5.FCStd": "c4872f021e4e54a573511bb7ed9ddf40730229a986b81f507c72b87073306e89",
    "examples/plate/revised/plate-50x35x5.step": REF_HASH,
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(length, name, extra=(), success=True):
    out = RUN / name
    args = [sys.executable, str(ROOT / "src/tools/cad_runner.py"), "--length-mm", str(length),
            "--output-dir", str(out), "--reference-step", str(REFERENCE), "--reference-sha256", REF_HASH,
            "--deadline-seconds", "60", *extra]
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=75)
    (RUN / (name + ".stdout")).write_text(r.stdout)
    (RUN / (name + ".stderr")).write_text(r.stderr)
    value = json.loads(r.stdout)
    if success:
        assert r.returncode == 0, value
        assert value["units"] == "mm" and value["executionMode"] == "live"
        assert value["engine"]["name"] == "build123d" and value["engine"]["version"] == "0.11.1"
        assert value["geometryHash"] == digest(out / "candidate.step")
        assert value["sourceSha256"] == digest(out / "source.py")
        checks = {c["checkId"]: c for c in value["checks"]}
        assert len(checks) == len(value["checks"]) and set(checks) == REQUIRED
        for c in checks.values():
            assert c["method"] and c["state"] in ("passed", "failed", "not_evaluated")
        assert all(c["state"] == "passed" for key,c in checks.items() if key != "margin.end_material"), checks
        assert [stage["role"] for stage in value["stages"]] == ["generator", "regenerator", "verifier", "export_verifier"]
        for stage in value["stages"]:
            assert subprocess.run(["docker", "inspect", stage["containerName"]],capture_output=True).returncode != 0
        assert (out / "preview.stl").is_file()
        assert b"from build123d" in (out / "source.py").read_bytes()
        assert sum(p.stat().st_size for p in out.iterdir() if p.is_file()) <= 25*1024*1024
        return value, out
    assert r.returncode != 0 and value["error"]["code"]
    assert "checks" not in value or not any(c["state"] == "passed" for c in value["checks"])
    return value, out


def independent_stl(path, length):
    data = path.read_bytes()
    triangles = struct.unpack_from("<I", data, 80)[0]
    assert 0 < triangles <= 100000 and len(data) == 84+50*triangles
    edge_uses = {}
    adjacency = [set() for _ in range(triangles)]
    points = []
    volume = 0
    for index in range(triangles):
        v = struct.unpack_from("<12fH", data, 84+50*index)
        tri = [tuple(v[j:j+3]) for j in (3,6,9)]
        assert all(math.isfinite(x) for p in tri for x in p)
        points.extend(tri)
        a,b,c = tri
        volume += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
        for a,b in zip(tri, tri[1:]+tri[:1]):
            assert a != b
            edge_uses.setdefault(tuple(sorted((a,b))), []).append((index,a,b))
    for uses in edge_uses.values():
        assert len(uses) == 2, "Mesh is not closed/manifold"
        (i,a,b),(j,c,d) = uses
        assert a == d and b == c, "Mesh winding inconsistent"
        adjacency[i].add(j); adjacency[j].add(i)
    seen, stack = set(), [0]
    while stack:
        i = stack.pop()
        if i not in seen:
            seen.add(i);stack.extend(adjacency[i]-seen)
    assert len(seen) == triangles
    for i,span in enumerate((length,35,5)):
        assert abs(min(p[i] for p in points)) <= 0.01
        assert abs(max(p[i] for p in points)-span) <= 0.01
    expected = length*35*5-2*math.pi*9*5
    assert volume > 0 and abs(volume-expected)/expected <= 0.001


for length, margin, state in ((50,12,"passed"),(30,2,"failed"),(36,5,"passed")):
    value,out = run(length,"length-"+str(length))
    check = next(c for c in value["checks"] if c["checkId"] == "margin.end_material")
    assert check["state"] == state and abs(check["measuredValue"]-margin) <= 0.01, check
    assert len(check["measured"]["closestPointPairs"]) == 2
    for pair in check["measured"]["closestPointPairs"]:
        assert len(pair) == 2 and all(len(p)==3 for p in pair)
        assert abs(math.dist(*pair)-margin)<=0.01
    independent_stl(out/"preview.stl",length)
    print("numeric case",length,"margin",margin,state,flush=True)

for invalid in (0,-1,"NaN","inf"):
    value,_ = run(invalid,"invalid-"+str(invalid),success=False)
    assert value["error"]["code"] == "INVALID_PARAMETERS"
value,_ = run(36,"wrong-hash",("--reference-sha256","0"*64),success=False)
assert value["error"]["code"] == "INPUT_REVISION_MISMATCH"
value,_ = run(36,"missing-input",("--reference-step",str(RUN/"missing.step")),success=False)
assert value["error"]["code"] == "INPUT_NOT_FOUND"
value,_ = run(36,"timeout",("--deadline-seconds","0.05"),success=False)
assert value["error"]["code"] == "TOOL_TIMEOUT"
for path,sha in PRESERVE.items():
    assert digest(ROOT/path)==sha, "Reference changed: "+path
print("TOOLS-02 real numeric/geometry/export/invalid/deadline checks passed. These fixture requests do not establish API integration or user acceptance.")
