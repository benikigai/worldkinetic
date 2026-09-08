"""Actual trusted-stage deadline test, preregistered before adapter refinement."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/tools'))
from cad_runner import Runtime, CoreError

runtime = Runtime(60)
started = time.monotonic()
try:
    runtime.stage('verifier', {'verify.py': b'import time\nfrom pathlib import Path\ntime.sleep(35)\nPath("/out/measurement.json").write_text("{}")\n'}, {'measurement.json'})
except CoreError as exc:
    assert exc.code == 'TOOL_TIMEOUT', exc
else:
    raise AssertionError('Verifier exceeded its 30 second stage cap')
elapsed = time.monotonic()-started
assert 29 <= elapsed <= 34, elapsed
assert runtime.stages[-1]['removed'] is True
print('Actual verifier deadline terminated and removed its container in', round(elapsed, 3), 'seconds')
