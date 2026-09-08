"""Recheck retained sealed handle geometry with current trusted exporters, not source."""
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
from handle_pipeline import trusted_files

original = safe_path(sys.argv[1]) / 'verifier/input'
report_path = Path(sys.argv[2])
runtime = Runtime(90)
signal.signal(signal.SIGTERM, cancelled)
signal.signal(signal.SIGINT, cancelled)
lock_path = safe_path(os.environ.get('WORLDKINETICS_CAD_LOCK_PATH',
                                    str(Path('/tmp').resolve() / f'worldkinetics-numeric-cad-{os.getuid()}.lock')))
lock = os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW)
report = {'status': 'failed', 'runtime': str(runtime.private), 'stages': runtime.stages}
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
    names = ['config.json', 'requirements.json', 'candidate.step', 'regenerated.step', 'reference.step', 'datums.json']
    if (original / 'baseline.step').exists():
        names.append('baseline.step')
    inputs = {name: read_regular(original / name) for name in names}
    inputs.update(trusted_files())
    inputs['verify.py'] = (Path(__file__).resolve().parents[2] / 'src/tools/handle_verify.py').read_bytes()
    first = runtime.stage('verifier', inputs, {'preview.stl', 'measurement.json'})
    final = runtime.stage('export_verifier', {**inputs, 'preview.stl': first['preview.stl'],
                          'checked.step': inputs['candidate.step']}, {'measurement.json'})
    a, b = json.loads(first['measurement.json']), json.loads(final['measurement.json'])
    report.update({'geometry': a, 'exports': b})
    assert all(c['state'] == 'passed' for c in a['checks'] + b['checks'])
    assert all(stage['removed'] for stage in runtime.stages)
    report['status'] = 'passed'
finally:
    os.close(lock)
    report_path.write_text(json.dumps(report, indent=2))
print(json.dumps({'status': report['status'], 'runtime': report['runtime'],
                  'checks': [(c['checkId'], c['state']) for c in a['checks'] + b['checks']],
                  'meshing': a['meshing']}))
