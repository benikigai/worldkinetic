"""Internal isolated plate candidate CLI. Host Python 3.9+, standard library only."""
import argparse
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import traceback
import uuid

from requirements_binding import validate_binding

IMAGE_ID = "sha256:bba502dc5c3fb943c078cdcb5c0a4b9faa321839ceb59bcfd5c41c33cbe0c440"
MAX_BYTES = 25 * 1024 * 1024
HERE = Path(__file__).resolve().parent


class CoreError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise CoreError("INVALID_PARAMETERS", message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(value):
    path = Path(os.path.abspath(value))
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise CoreError("INVALID_PARAMETERS", "Symlink paths are not supported")
    if any(c in str(path) for c in (",", "\n", "\r", "\x00")):
        raise CoreError("INVALID_PARAMETERS", "Unsafe path")
    return path


def read_regular(path, limit=MAX_BYTES):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= limit:
            raise CoreError("EXPORT_FAILED", "Invalid file type, link count or size")
        data = stream.read(limit + 1)
        if len(data) != info.st_size:
            raise CoreError("EXPORT_FAILED", "File changed or exceeded size limit")
        return data


def audit(directory, allowed, complete=True):
    entries = list(directory.iterdir())
    if any(p.name not in allowed for p in entries) or (complete and {p.name for p in entries} != set(allowed)):
        raise CoreError("EXPORT_FAILED", "Unexpected or missing stage output")
    total = 0
    for path in entries:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise CoreError("EXPORT_FAILED", "Unsafe stage output")
        total += info.st_size
    if total > MAX_BYTES:
        raise CoreError("EXPORT_FAILED", "Output exceeds 25 MiB")


class Runtime:
    def __init__(self, deadline):
        self.end = time.monotonic() + deadline
        self.private = Path(tempfile.mkdtemp(prefix="worldkinetics-cad-")).resolve()
        self.stages = []
        self.image = IMAGE_ID

    def remaining(self):
        value = self.end - time.monotonic()
        if value <= 0:
            raise CoreError("TOOL_TIMEOUT", "Global CAD deadline exceeded")
        return value

    def command(self, args):
        try:
            result = subprocess.run(args, capture_output=True, timeout=self.remaining())
        except subprocess.TimeoutExpired as exc:
            raise CoreError("TOOL_TIMEOUT", "Global CAD deadline exceeded") from exc
        except FileNotFoundError as exc:
            raise CoreError("TOOL_UNAVAILABLE", "Docker CLI is unavailable") from exc
        if result.returncode:
            (self.private / "runtime-error.log").write_bytes(result.stderr)
            raise CoreError("TOOL_UNAVAILABLE", "Docker runtime is unavailable")
        return result.stdout

    def inspect_image(self):
        requested = os.environ.get("WORLDKINETICS_CAD_IMAGE", IMAGE_ID)
        info = json.loads(self.command(["docker", "image", "inspect", requested]))[0]
        if info["Id"] != IMAGE_ID:
            raise CoreError("TOOL_UNAVAILABLE", "Configured image differs from selected runtime")
        return {"name": "build123d", "version": "0.11.1", "ocpVersion": "7.9.3.1.1",
                "imageId": info["Id"], "architecture": info["Architecture"]}

    def stage(self, role, files, expected):
        self.remaining()
        stage_end = min(self.end, time.monotonic() + (60 if role in ("generator", "regenerator") else 30))

        def stage_remaining():
            value = stage_end - time.monotonic()
            if value <= 0:
                raise CoreError("TOOL_TIMEOUT", "CAD stage deadline exceeded")
            return value

        root = self.private / role
        inp, out = root / "input", root / "output"
        inp.mkdir(parents=True)
        out.mkdir(mode=0o777)
        out.chmod(0o777)
        for name, data in files.items():
            (inp / name).write_bytes(data)
            (inp / name).chmod(0o444)
        inp.chmod(0o555)
        name = "wk-cad-" + role.replace("_", "-") + "-" + uuid.uuid4().hex[:16]
        trace = {"role": role, "containerName": name, "removed": False,
                 "inputSha256": {key: sha(data) for key, data in files.items()}}
        self.stages.append(trace)
        args = ["docker", "create", "--pull", "never", "--name", name, "--read-only", "--network", "none",
                "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--memory", "2g", "--memory-swap", "2g", "--cpus", "2", "--pids-limit", "64",
                "--ulimit", "fsize=26214400:26214400", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
                "--mount", f"type=bind,src={inp},dst=/input,readonly",
                "--mount", f"type=bind,src={out},dst=/out", "--env", "HOME=/tmp",
                "--env", "OPENBLAS_NUM_THREADS=1", "--env", "OMP_NUM_THREADS=1",
                self.image, "python", "-B", "/input/source.py" if role in ("generator", "regenerator") else "/input/verify.py"]
        started = time.monotonic()
        process = None
        creating = True
        unresolved_create = False
        try:
            with (root / "stdout.log").open("wb") as stdout, (root / "stderr.log").open("wb") as stderr:
                process = subprocess.Popen(args, stdout=stdout, stderr=stderr, start_new_session=True)
                while process.poll() is None:
                    time.sleep(min(0.01, stage_remaining()))
                if process.returncode:
                    raise CoreError("TOOL_UNAVAILABLE", "Container creation failed; diagnostics retained privately")
                stage_remaining()
                creating = False
                process = subprocess.Popen(["docker", "start", "--attach", name], stdout=stdout, stderr=stderr,
                                           start_new_session=True)
                while process.poll() is None:
                    time.sleep(min(0.05, stage_remaining()))
                    audit(out, expected, complete=False)
                    if stdout.tell() + stderr.tell() > MAX_BYTES:
                        raise CoreError("EXPORT_FAILED", "Stage log size exceeded")
                stage_remaining()
                trace["exitCode"] = process.returncode
                if process.returncode:
                    code = "EXECUTION_FAILED" if role in ("generator", "regenerator") else "CHECK_FAILED"
                    if role == "export_verifier":
                        code = "EXPORT_FAILED"
                    raise CoreError(code, "CAD stage failed; raw diagnostics retained privately")
        finally:
            cancel_during_cleanup = False

            def defer_cancel(signum, frame):
                nonlocal cancel_during_cleanup
                cancel_during_cleanup = True

            handlers = {sig: signal.signal(sig, defer_cancel) for sig in (signal.SIGINT, signal.SIGTERM)}
            # Killing the CLI alone does not stop a container or its detached children.
            try:
                if process is not None and process.poll() is None:
                    if creating:
                        # Resolve create before removal: a cancelled HTTP create
                        # can otherwise register a container after rm has returned.
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            unresolved_create = True
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait(timeout=5)
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                removed = subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=5)
                (root / "cleanup.log").write_bytes(removed.stdout + removed.stderr)
                present = subprocess.run(["docker", "container", "ls", "-a", "--filter", "name=^/" + name + "$",
                                          "--format", "{{.Names}}"], capture_output=True, timeout=5)
                trace["removed"] = not unresolved_create and present.returncode == 0 and not present.stdout.strip()
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise CoreError("TOOL_UNAVAILABLE", "Container cleanup could not be confirmed") from exc
            finally:
                for sig, handler in handlers.items():
                    signal.signal(sig, handler)
            trace["seconds"] = round(time.monotonic() - started, 4)
            if not trace["removed"]:
                raise CoreError("TOOL_UNAVAILABLE", "Container cleanup could not be confirmed")
            if cancel_during_cleanup:
                raise CoreError("TOOL_TIMEOUT", "CAD execution cancelled during cleanup")
        self.remaining()
        audit(out, expected)
        sealed = {p.name: read_regular(p) for p in out.iterdir()}
        sealed_dir = root / "sealed"
        sealed_dir.mkdir()
        for key, data in sealed.items():
            (sealed_dir / key).write_bytes(data)
            (sealed_dir / key).chmod(0o444)
        sealed_dir.chmod(0o555)
        trace["sealedOutputs"] = {key: sha(value) for key, value in sealed.items()}
        return sealed


def source_for(length):
    return ("from build123d import Box, Cylinder, Pos, Align, export_step\n\n"
            f"length_mm = {length!r}\nwidth_mm = 35.0\nbase_mm = 5.0\n"
            "plate = Box(length_mm, width_mm, base_mm, align=(Align.MIN, Align.MIN, Align.MIN))\n"
            "for x in ((length_mm - 20) / 2, (length_mm + 20) / 2):\n"
            "    plate -= Pos(x, 17.5, 0) * Cylinder(3, base_mm, align=(Align.CENTER, Align.CENTER, Align.MIN))\n"
            "export_step(plate, '/out/candidate.step')\n").encode()


def execute(args, runtime):
    if not math.isfinite(args.length_mm) or args.length_mm <= 0:
        raise CoreError("INVALID_PARAMETERS", "Length must be finite and positive")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", args.reference_sha256):
        raise CoreError("INVALID_PARAMETERS", "Reference SHA-256 must contain 64 hex digits")
    reference = safe_path(args.reference_step)
    if not reference.exists():
        raise CoreError("INPUT_NOT_FOUND", "Reference STEP not found")
    ref = read_regular(reference)
    if sha(ref) != args.reference_sha256.lower():
        raise CoreError("INPUT_REVISION_MISMATCH", "Reference STEP SHA-256 mismatch")
    binding_bytes = None
    setup_id = "resize_centered_v1"
    if args.requirements_json:
        binding_bytes = read_regular(safe_path(args.requirements_json), 128 * 1024)
        try:
            setup_id = validate_binding(binding_bytes, args.length_mm, sha(ref))["setupId"]
        except (ValueError, KeyError, TypeError) as exc:
            raise CoreError("EVIDENCE_CONFLICT", "Requirements binding mismatch") from exc
    output = safe_path(args.output_dir)
    if output == reference or output in reference.parents or not output.parent.is_dir():
        raise CoreError("INVALID_PARAMETERS", "Output must be a new directory under an existing parent")
    if output.exists():
        raise CoreError("INVALID_PARAMETERS", "Output directory already exists")
    engine = runtime.inspect_image()
    source = read_regular(safe_path(args.source_file), 65536) if args.source_file else source_for(args.length_mm)
    try:
        source.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise CoreError("INVALID_PARAMETERS", "Source must be UTF-8") from exc
    if len(source) > 65536:
        raise CoreError("INVALID_PARAMETERS", "Source exceeds 64 KiB")
    candidate_inputs = {"source.py": source, "reference.step": ref}
    generated = runtime.stage("generator", candidate_inputs, {"candidate.step"})
    regenerated = runtime.stage("regenerator", candidate_inputs, {"candidate.step"})
    config = {"length": args.length_mm, "setupId": setup_id, "referenceSha256": sha(ref),
              "regeneratedSha256": sha(regenerated["candidate.step"]),
              "geometryHash": sha(generated["candidate.step"]), "sourceSha256": sha(source)}
    trusted = {"verify.py": (HERE / "verify.py").read_bytes(), "mesh_checks.py": (HERE / "mesh_checks.py").read_bytes(),
               "candidate.step": generated["candidate.step"], "regenerated.step": regenerated["candidate.step"],
               "reference.step": ref, "config.json": json.dumps(config).encode()}
    trusted["requirements_binding.py"] = (HERE / "requirements_binding.py").read_bytes()
    if binding_bytes is not None:
        trusted["requirements.json"] = binding_bytes
    verified = runtime.stage("verifier", trusted, {"measurement.json", "preview.stl"})
    first = json.loads(verified["measurement.json"])
    exported = runtime.stage("export_verifier", {**trusted, "preview.stl": verified["preview.stl"],
                                                "checked.step": generated["candidate.step"]}, {"measurement.json"})
    final = json.loads(exported["measurement.json"])
    if first["engine"] != final["engine"] or first["engine"] != {"version": engine["version"], "ocpVersion": engine["ocpVersion"]}:
        raise CoreError("TOOL_UNAVAILABLE", "Measured engine versions differ from selected runtime")
    checks = first["checks"] + final["checks"]
    value = {"executionMode": "live", "scope": "python_source_candidate" if args.source_file else "numeric_fixture_core", "setupId": setup_id,
             "registrySha256": "d9de0bbe0c6a03f101d5f9562360ac10d0a4216401533eb9be0b4148c8a9aa33",
             "units": "mm", "frame": {"handedness": "right", "z": "up", "origin": "min_plate_corner"},
             "lengthMm": args.length_mm, "sourceSha256": sha(source), "geometryHash": config["geometryHash"],
             "referenceSha256": sha(ref), "engine": engine,
             "runtime": {"python": final["python"], "isolation": "separate_restricted_containers"},
             "checks": checks, "stages": runtime.stages,
             "status": "checked" if all(c["state"] == "passed" for c in checks) else "check_failed",
             "accepted": False, "physicallyTested": False}
    if value["status"] == "check_failed":
        value["checkFailureCode"] = "CHECK_FAILED"
    artifacts = {"source.py": source, "editable.py": source,
                 "candidate.step": generated["candidate.step"], "preview.stl": verified["preview.stl"]}
    value["artifacts"] = [{"name": name, "sha256": sha(data), "bytes": len(data)} for name, data in artifacts.items()]
    artifacts["result.json"] = (json.dumps(value, indent=2, allow_nan=False) + "\n").encode()
    if sum(map(len, artifacts.values())) > MAX_BYTES:
        raise CoreError("EXPORT_FAILED", "Total output exceeds 25 MiB")
    runtime.remaining()
    output.mkdir(mode=0o700)
    try:
        for name, data in artifacts.items():
            with (output / name).open("xb") as stream:
                stream.write(data)
            (output / name).chmod(0o444)
        audit(output, artifacts)
    except BaseException:
        for name in artifacts:
            (output / name).unlink(missing_ok=True)
        output.rmdir()
        raise
    return value


def cancelled(signum, frame):
    raise CoreError("TOOL_TIMEOUT", "CAD execution cancelled")


def main():
    runtime = None
    lock = None
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--length-mm", required=True, type=float)
        parser.add_argument("--output-dir", required=True)
        parser.add_argument("--reference-step")
        parser.add_argument("--reference-sha256")
        parser.add_argument("--deadline-seconds", required=True, type=float)
        parser.add_argument("--requirements-json")
        parser.add_argument("--source-file", help="Exact UTF-8 candidate source; no host execution")
        parser.add_argument("--handle", action="store_true")
        parser.add_argument("--create-handle-reference", action="store_true")
        parser.add_argument("--datums-file")
        parser.add_argument("--baseline-step")
        args = parser.parse_args()
        if args.handle and args.create_handle_reference:
            raise CoreError("INVALID_PARAMETERS", "Choose one handle operation")
        if not args.create_handle_reference and (not args.reference_step or not args.reference_sha256):
            raise CoreError("INVALID_PARAMETERS", "Reference STEP and hash are required")
        if (args.handle or args.create_handle_reference) and not args.datums_file:
            raise CoreError("INVALID_PARAMETERS", "Canonical datums are required")
        if args.handle and (not args.requirements_json or not args.source_file):
            raise CoreError("INVALID_PARAMETERS", "Handle requires source and requirements")
        if not math.isfinite(args.deadline_seconds) or args.deadline_seconds <= 0:
            raise CoreError("INVALID_PARAMETERS", "Deadline must be finite and positive")
        runtime = Runtime(min(args.deadline_seconds, 180))
        signal.signal(signal.SIGTERM, cancelled)
        signal.signal(signal.SIGINT, cancelled)
        # A shared host lock serializes this numeric core across worktrees.
        # /tmp is stable across per-job TMPDIR values. Resolve its platform alias
        # before checking the explicitly selected path for symlinks.
        default_lock = Path("/tmp").resolve() / f"worldkinetics-numeric-cad-{os.getuid()}.lock"
        lock_value = os.environ.get("WORLDKINETICS_CAD_LOCK_PATH", str(default_lock))
        if not Path(lock_value).is_absolute():
            raise CoreError("INVALID_PARAMETERS", "Lock path must be absolute")
        lock_path = safe_path(lock_value)
        lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        info = os.fstat(lock)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid()
                or info.st_mode & 0o077):
            raise CoreError("INVALID_PARAMETERS", "Unsafe CAD lock file")
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(min(0.05, runtime.remaining()))
        if args.handle or args.create_handle_reference:
            from handle_pipeline import execute_handle, create_reference
            value = create_reference(args, runtime) if args.create_handle_reference else execute_handle(args, runtime)
        else:
            value = execute(args, runtime)
        print(json.dumps(value, allow_nan=False))
        return 0
    except Exception as exc:
        if runtime:
            (runtime.private / "host-error.log").write_text(traceback.format_exc())
        code = exc.code if isinstance(exc, CoreError) else "EXPORT_FAILED"
        message = str(exc) if isinstance(exc, CoreError) else "CAD execution failed; diagnostics retained privately"
        value = {"error": {"code": code, "message": message}, "stages": runtime.stages if runtime else []}
        print(json.dumps(value))
        return 1
    finally:
        if lock is not None:
            os.close(lock)


if __name__ == "__main__":
    # Keep exception identity when the optional handle pipeline imports this runtime.
    sys.modules["cad_runner"] = sys.modules[__name__]
    sys.exit(main())
