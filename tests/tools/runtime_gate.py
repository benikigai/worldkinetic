"""Independent TOOLS-01 runtime acceptance, bootstrapped OUTSIDE_WRAPPER.

Runs fixed probes, never candidate-supplied measurements. Private raw outputs stay
under .runtime. No API or product adapter is implemented by this test harness.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
IMAGE = os.environ.get("WORLDKINETICS_CAD_IMAGE", "worldkinetics-tools-gate:build123d-0.11.1-gl")
RUN = ROOT / ".runtime/tools/gate" / ("acceptance-" + uuid.uuid4().hex[:10])
RUN.mkdir(parents=True)
RESULT = {"taskId": "TOOLS-01", "evidenceMode": "OUTSIDE_WRAPPER", "units": "mm", "checks": [], "artifacts": []}


def command(args, timeout=60):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def check(name, outcome, detail):
    RESULT["checks"].append({"id": name, "outcome": "pass" if outcome else "fail", "detail": detail})
    print(name, "PASS" if outcome else "FAIL", flush=True)
    if not outcome:
        raise AssertionError(name + ": " + str(detail))


def run_probe(name, source, inputs=None, timeout=60):
    stage = RUN / name
    inp, out = stage / "input", stage / "output"
    inp.mkdir(parents=True)
    out.mkdir(mode=0o777)
    out.chmod(0o777)
    (inp / "probe.py").write_text(source)
    for key, value in (inputs or {}).items():
        shutil.copyfile(value, inp / key)
    container = "wk-tools-gate-" + uuid.uuid4().hex[:12]
    args = ["docker", "run", "--name", container, "--read-only", "--network", "none",
            "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--memory", "2g", "--memory-swap", "2g", "--cpus", "2", "--pids-limit", "64",
            "--ulimit", "fsize=26214400:26214400", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
            "--mount", f"type=bind,src={inp},dst=/input,readonly",
            "--mount", f"type=bind,src={out},dst=/out",
            "--env", "HOME=/tmp", "--env", "OPENBLAS_NUM_THREADS=1", "--env", "OMP_NUM_THREADS=1",
            IMAGE, "python", "/input/probe.py"]
    start = time.monotonic()
    timed_out = False
    try:
        result = command(args, timeout)
        (stage / "stdout.txt").write_text(result.stdout)
        (stage / "stderr.txt").write_text(result.stderr)
        inspection = command(["docker", "inspect", container])
        info = json.loads(inspection.stdout)[0]
        (stage / "inspect.json").write_text(inspection.stdout)
        host = info["HostConfig"]
        check(name + ".configured_boundary", host["ReadonlyRootfs"] and host["NetworkMode"] == "none"
              and host["PidsLimit"] == 64 and host["Memory"] == 2147483648
              and "ALL" in host["CapDrop"] and "no-new-privileges" in host["SecurityOpt"]
              and len(info["Mounts"]) == 2, {"nonroot": info["Config"]["User"], "mounts": len(info["Mounts"])})
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-3000:])
        check(name + ".container_stopped", not info["State"]["Running"], {"exitCode": result.returncode})
    except subprocess.TimeoutExpired:
        timed_out = True
    finally:
        removed = command(["docker", "rm", "-f", container])
        if removed.returncode != 0:
            raise RuntimeError("Could not remove isolated gate container: " + removed.stderr)
    missing = command(["docker", "inspect", container]).returncode != 0
    check(name + ".removed", missing, {"seconds": round(time.monotonic() - start, 3), "timedOut": timed_out})
    return out, timed_out


try:
    info = json.loads(command(["docker", "image", "inspect", IMAGE]).stdout)[0]
    RESULT["engine"] = {"name": "build123d", "version": "0.11.1", "imageId": info["Id"], "architecture": info["Architecture"]}
    sentinel = RUN / "host-only-sentinel.txt"
    sentinel.write_text("harmless-host-boundary-sentinel")
    ref = ROOT / "examples/plate/revised/plate-50x35x5.step"
    before = hashlib.sha256(ref.read_bytes()).hexdigest()
    boundary = '''import json,os,socket
from pathlib import Path
results={"nonroot":os.getuid()==65532}
for key,path,operation in [
 ("host_read_denied",SENTINEL,"read"),
 ("reference_write_denied","/input/reference.step","write"),
 ("root_write_denied","/etc/wk-gate","write"),
 ("socket_absent","/var/run/docker.sock","read"),
 ("verifier_absent","/verifier/verify.py","read")]:
 try:
  if operation=="read": Path(path).read_bytes()
  else: Path(path).write_text("must not succeed")
  results[key]=False
 except OSError: results[key]=True
try:
 s=socket.create_connection(("1.1.1.1",443),timeout=2);s.close();results["network_denied"]=False
except OSError: results["network_denied"]=True
Path("/out/boundary.json").write_text(json.dumps(results))
'''.replace("SENTINEL", repr(str(sentinel)))
    out, _ = run_probe("boundary", boundary, {"reference.step": ref})
    values = json.loads((out / "boundary.json").read_text())
    for name, passed in values.items():
        check(name, passed, {"observed": passed})
    check("reference_original_hash", before == hashlib.sha256(ref.read_bytes()).hexdigest(), {"sha256": before})

    generator = '''from build123d import Box,Cylinder,Pos,Align,export_step
p=Box(50,35,5,align=(Align.MIN,Align.MIN,Align.MIN))
for x in (15,35): p=p-Pos(x,17.5,0)*Cylinder(3,5,align=(Align.CENTER,Align.CENTER,Align.MIN))
export_step(p,"/out/candidate.step")
'''
    out, _ = run_probe("generate", generator)
    candidate = out / "candidate.step"
    sealed = RUN / "sealed.step"
    shutil.copyfile(candidate, sealed)
    sealed.chmod(0o444)
    sha = hashlib.sha256(sealed.read_bytes()).hexdigest()
    verifier = '''import json,math,importlib.metadata
from pathlib import Path
from build123d import import_step,export_stl,Cylinder,Pos,Align
p=import_step("/input/candidate.step")
b=p.bounding_box()
intersections=[p & (Pos(x,17.5,0)*Cylinder(3,5,align=(Align.CENTER,Align.CENTER,Align.MIN))) for x in (15,35)]
bores=[0 if s is None else s.volume for s in intersections]
export_stl(p,"/out/preview.stl",tolerance=0.001,angular_tolerance=0.1)
Path("/out/measurement.json").write_text(json.dumps({"valid":p.is_valid,"solids":len(p.solids()),"volume":p.volume,"bounds":[b.size.X,b.size.Y,b.size.Z],"bores":bores,"engineVersion":importlib.metadata.version("build123d"),"ocpVersion":importlib.metadata.version("cadquery-ocp-novtk")}))
'''
    out, _ = run_probe("verify", verifier, {"candidate.step": sealed}, timeout=30)
    measured = json.loads((out / "measurement.json").read_text())
    expected = 50 * 35 * 5 - 2 * math.pi * 3**2 * 5
    check("plate.valid_solid", measured["valid"] and measured["solids"] == 1, measured)
    check("plate.dimensions", all(abs(a-b) <= 0.01 for a,b in zip(measured["bounds"], [50,35,5])), measured["bounds"])
    check("plate.volume", abs(measured["volume"]-expected) / expected <= 1e-5, {"actual":measured["volume"],"expected":expected})
    check("plate.through_bores", max(measured["bores"]) <= 0.01, measured["bores"])
    check("sealed_unchanged", sha == hashlib.sha256(sealed.read_bytes()).hexdigest(), {"sha256":sha})
    RESULT["engine"]["ocpVersion"] = measured["ocpVersion"]
    # Binary STL is reopened independently without the CAD process or its claims.
    import struct
    stl = out / "preview.stl"
    data = stl.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0]
    check("stl.byte_layout", len(data) == 84 + count*50 and 0<count<=100000, {"triangles":count,"bytes":len(data)})
    volume = 0.0
    xyz = []
    for i in range(count):
        v = struct.unpack_from("<12fH",data,84+i*50)
        a,b,c = v[3:6],v[6:9],v[9:12]
        xyz.extend((a,b,c))
        volume += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
    check("stl.volume", abs(abs(volume)-expected)/expected<=0.001, {"volume":volume})
    check("stl.bounds", all(abs(max(p[i] for p in xyz)-min(p[i] for p in xyz)-d)<=0.01 for i,d in enumerate([50,35,5])), {"dimensions":[50,35,5]})
    for artifact in (sealed,stl):
        RESULT["artifacts"].append({"path":str(artifact.relative_to(ROOT)),"sha256":hashlib.sha256(artifact.read_bytes()).hexdigest(),"bytes":artifact.stat().st_size})

    child = 'import time;from pathlib import Path;Path("/out/child-started.txt").write_text("started");time.sleep(5);Path("/out/escaped-child.txt").write_text("alive")'
    linger = f'import subprocess,sys,time\nfrom pathlib import Path\nsubprocess.Popen([sys.executable,"-c",{child!r}],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\nfor _ in range(100):\n if Path("/out/child-started.txt").exists(): break\n time.sleep(0.01)\nassert Path("/out/child-started.txt").exists()\n'
    out, _ = run_probe("linger", linger)
    time.sleep(5.5)
    check("lingering_child_killed", (out / "child-started.txt").exists() and not (out / "escaped-child.txt").exists(), {"markerAbsent":True})
    out, timed = run_probe("timeout", linger + '\nimport time;time.sleep(120)\n', timeout=2)
    time.sleep(5.5)
    check("timeout_failed_closed", timed and (out / "child-started.txt").exists() and not (out / "escaped-child.txt").exists(), {"timedOut":timed,"markerAbsent":not (out / "escaped-child.txt").exists()})
    RESULT["capabilityStatus"] = "pass"
except Exception as exc:
    RESULT["capabilityStatus"] = "no_go"
    RESULT["error"] = {"type":type(exc).__name__,"message":str(exc)}
finally:
    (RUN / "observed.json").write_text(json.dumps(RESULT,indent=2)+"\n")
    print(json.dumps({"report":str(RUN / "observed.json"),"status":RESULT.get("capabilityStatus")}),flush=True)
sys.exit(0 if RESULT.get("capabilityStatus")=="pass" else 1)
