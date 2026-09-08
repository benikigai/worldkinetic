"""Owned regression probes; fixed synthetic geometry, not application acceptance."""
import json
from pathlib import Path
import signal
import tempfile

from cad_runner import CoreError, HERE, Runtime, audit, cancelled, safe_path, source_for
from mesh_checks import inspect_mesh


def main():
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    runtime = Runtime(60)
    runtime.inspect_image()
    base = source_for(50).decode().split("export_step(plate,")[0]
    fixtures = base + '''
export_step(plate, '/out/good.step')
export_step(plate + Pos(70, 0, 0) * Box(1, 1, 1), '/out/extra.step')
export_step(plate + Pos(15, 17.5, 0) * Cylinder(3.001, 0.0001,
    align=(Align.CENTER, Align.CENTER, Align.MIN)), '/out/cap.step')
wrong = Box(50, 35, 5, align=(Align.MIN, Align.MIN, Align.MIN))
for x in (15, 34):
    wrong -= Pos(x, 17.5, 0) * Cylinder(3, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
export_step(wrong, '/out/wrong.step')
'''
    generated = runtime.stage("generator", {"source.py": fixtures.encode()},
                              {"good.step", "extra.step", "cap.step", "wrong.step"})
    probe = b'''import json
from pathlib import Path
from build123d import import_step, export_stl
from trusted_checks import inspect_shape
from mesh_checks import inspect_mesh
results = {}
for name in ('good', 'extra', 'cap', 'wrong'):
    shape = import_step('/input/' + name + '.step')
    measurement, _, _ = inspect_shape(shape, 50)
    results[name] = measurement
assert results['good']['solidOK'] and results['good']['holesOK']
assert not results['extra']['solidOK'] and results['extra']['solidCount'] == 2
assert not results['wrong']['holesOK']
assert not results['cap']['holesOK']
assert results['cap']['boreObstructions'][0]['solidCount'] > 0
assert 0 < results['cap']['boreObstructions'][0]['volumeMm3'] < 0.01
for name in ('good', 'cap', 'wrong'):
    shape = import_step('/input/' + name + '.step')
    path = Path('/out/' + name + '.stl')
    export_stl(shape, path, tolerance=0.001, angular_tolerance=0.1)
    state, measured = inspect_mesh(path, 50, [[0,0,0],[50,35,5]], results['good']['volume'])
    results[name]['mesh'] = {'state': state, 'measured': measured}
assert results['good']['mesh']['state'] == 'passed'
assert results['cap']['mesh']['state'] == 'failed'
assert results['wrong']['mesh']['state'] == 'failed'
Path('/out/probes.json').write_text(json.dumps(results, allow_nan=False))
'''
    result = runtime.stage("verifier", {**generated, "verify.py": probe,
                                       "trusted_checks.py": (HERE / "verify.py").read_bytes(),
                                       "mesh_checks.py": (HERE / "mesh_checks.py").read_bytes()},
                           {"probes.json", "good.stl", "cap.stl", "wrong.stl"})
    observations = json.loads(result["probes.json"])
    with tempfile.TemporaryDirectory(prefix="wk-output-probe-") as directory:
        root = Path(directory).resolve()
        (root / "linked").symlink_to(root / "missing")
        for operation in (lambda: safe_path(root / "linked"), lambda: audit(root, {"linked"})):
            try:
                operation()
            except CoreError:
                pass
            else:
                raise AssertionError("Symlink output accepted")
        (root / "linked").unlink()
        (root / "unknown").write_bytes(b"unexpected")
        try:
            audit(root, {"candidate.step"})
        except CoreError:
            pass
        else:
            raise AssertionError("Unexpected output accepted")
        (root / "truncated.stl").write_bytes(result["good.stl"][:-1])
        assert inspect_mesh(root / "truncated.stl", 50, [[0, 0, 0], [50, 35, 5]], 8467.2566)[0] == "failed"
    print(json.dumps({"scope": "owned_synthetic_regression_probes", "observations": observations,
                      "stages": runtime.stages}, allow_nan=False))


if __name__ == "__main__":
    main()
