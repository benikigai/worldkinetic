from pathlib import Path
import hashlib
assert set(p.name for p in Path('/input').iterdir()) == {'source.py','reference.step','datums.json','baseline.step'}
assert hashlib.sha256(Path('/input/datums.json').read_bytes()).hexdigest() == '6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83'
for name in ('reference.step','datums.json','baseline.step'):
    try:
        Path('/input/'+name).write_bytes(b'changed')
        raise AssertionError('input writable')
    except OSError: pass
from build123d import *
p = import_step('/input/baseline.step')
p += Pos(-10,-7,25) * Box(20,14,10,align=(Align.MIN,Align.MIN,Align.MIN))
p += Pos(-6,7,27) * Box(12,5,5,align=(Align.MIN,Align.MIN,Align.MIN))
export_step(p, '/out/candidate.step')
