from build123d import *

reference = import_step('/input/reference.step')
with BuildSketch(Plane.XZ) as profile:
    with BuildLine():
        ThreePointArc((-54,32), (0,40), (54,32))
        Line((54,32), (54,24))
        ThreePointArc((54,24), (0,32), (-54,24))
        Line((-54,24), (-54,32))
    make_face()
grip = extrude(profile.sketch, amount=5, both=True)
grip = fillet(grip.edges(), radius=1.5)
handle = reference + grip
for x in (-48,48):
    handle += Pos(x,0,2) * Cylinder(5,30,align=(Align.CENTER,Align.CENTER,Align.MIN))
export_step(handle, '/out/candidate.step')
