from build123d import *
from math import sqrt, sin, cos, atan2, pi

baseline = import_step('/input/baseline.step')
with BuildSketch(Plane.XZ) as arch:
    with BuildLine():
        ThreePointArc((-54,32), (0,40), (54,32))
        Line((54,32), (54,24))
        ThreePointArc((54,24), (0,32), (-54,24))
        Line((-54,24), (-54,32))
    make_face()
bridge = extrude(arch.sketch, amount=12, both=True)
# Tangent concave arcs join the sidewall to the rounded thumb lobe.
fx = 6 + sqrt(35)
tx, ty = 6 + 2*sqrt(35)/3, 8 + 2/3
a = atan2(ty-9, tx-fx)
mx, my = fx + 2*cos((-pi/2+a)/2), 9 + 2*sin((-pi/2+a)/2)
b = atan2(ty-8, tx-6)
nx, ny = 6 + 4*cos((b+pi/2)/2), 8 + 4*sin((b+pi/2)/2)
with BuildSketch(Plane.XY.offset(20)) as footprint:
    with BuildLine():
        Polyline((54,-7), (54,7), (fx,7))
        ThreePointArc((fx,7), (mx,my), (tx,ty))
        ThreePointArc((tx,ty), (nx,ny), (6,12))
        Line((6,12), (-6,12))
        ThreePointArc((-6,12), (-nx,ny), (-tx,ty))
        ThreePointArc((-tx,ty), (-mx,my), (-fx,7))
        Polyline((-fx,7), (-54,7), (-54,-7), (54,-7))
    make_face()
prism = extrude(footprint.sketch, amount=25)
grip = bridge & prism
grip = fillet(grip.edges(), radius=1.5)
handle = baseline + grip
export_step(handle, '/out/candidate.step')
