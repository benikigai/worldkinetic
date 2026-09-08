from pathlib import Path
import hashlib
assert set(p.name for p in Path('/input').iterdir()) == {'source.py','reference.step','datums.json'}
assert hashlib.sha256(Path('/input/datums.json').read_bytes()).hexdigest() == '6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83'
for name in ('reference.step','datums.json'):
    try:
        Path('/input/'+name).write_bytes(b'changed')
        raise AssertionError('input writable')
    except OSError: pass
from build123d import *
p = import_step('/input/reference.step')
for x in (-48,48):
    p += Pos(x,0,2) * Cylinder(5,29,align=(Align.CENTER,Align.CENTER,Align.MIN))
p += Pos(-54,0,31) * Rot(0,90,0) * Cylinder(6,108,align=(Align.CENTER,Align.CENTER,Align.MIN))
export_step(p, '/out/candidate.step')
