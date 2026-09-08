from pathlib import Path
import hashlib
assert not Path('/input/verify.py').exists()
assert not Path('/input/config.json').exists()
assert not Path('/input/requirements.json').exists()
assert hashlib.sha256(Path('/input/datums.json').read_bytes()).hexdigest() == '6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83'
assert Path('/input/baseline.step').exists() == True
for name in ('reference.step','datums.json','baseline.step'):
    try:
        Path('/input/'+name).write_bytes(b'changed')
        raise AssertionError('input writable')
    except OSError: pass
from build123d import *
p = import_step('/input/baseline.step')
p += Pos(-32,-7,25) * Box(64,14,10,align=(Align.MIN,Align.MIN,Align.MIN))
p += Pos(-5,7,29) * Box(10,2,0.5,align=(Align.MIN,Align.MIN,Align.MIN))
export_step(p, '/out/candidate.step')
