"""Host acceptance harness using the existing isolated runtime and common lock."""
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/tools'))
from cad_runner import Runtime, cancelled, read_regular, safe_path

runtime = Runtime(45)
signal.signal(signal.SIGTERM, cancelled)
signal.signal(signal.SIGINT, cancelled)
lock_path = safe_path(os.environ.get('WORLDKINETICS_CAD_LOCK_PATH',
                                    str(Path('/tmp').resolve() / f'worldkinetics-numeric-cad-{os.getuid()}.lock')))
lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
try:
    info = os.fstat(lock)
    assert stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
    assert not info.st_mode & 0o077
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            time.sleep(min(0.05, runtime.remaining()))
    runtime.inspect_image()
    result = runtime.stage('verifier', {
        'verify.py': Path(__file__).with_name('handle_reference_probe.py').read_bytes(),
        'reference.step': read_regular(safe_path(sys.argv[1])),
        'preview.stl': read_regular(safe_path(sys.argv[2])),
    }, {'measurement.json'})
    assert all(stage['removed'] for stage in runtime.stages)
    print(json.dumps({'measurement': json.loads(result['measurement.json']), 'stages': runtime.stages}))
finally:
    os.close(lock)
