from pathlib import Path
import hashlib
assert not Path('/input/verify.py').exists()
assert not Path('/input/config.json').exists()
assert not Path('/input/requirements.json').exists()
assert hashlib.sha256(Path('/input/datums.json').read_bytes()).hexdigest() == '6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83'
assert Path('/input/baseline.step').exists() == False
from build123d import *
p = import_step('/input/reference.step')
for x in (-48,48):
    p += Pos(x,0,2) * Cylinder(5,26,align=(Align.CENTER,Align.CENTER,Align.MIN))
p += Pos(-54,-5,25) * Box(108,10,10,align=(Align.MIN,Align.MIN,Align.MIN))
export_step(p, '/out/candidate.step')
