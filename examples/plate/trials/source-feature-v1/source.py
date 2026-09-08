from build123d import *
from pathlib import Path
assert not Path('/input/verify.py').exists()
assert not Path('/input/config.json').exists()
assert not Path('/input/requirements.json').exists()
p = import_step('/input/reference.step')
p = p + Pos(25,27.5,5) * extrude(SlotOverall(10,4), amount=2)
export_step(p, '/out/candidate.step')
