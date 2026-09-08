from build123d import *

# Fixed mounting datums and pads; retained without cuts or fillets.
reference = import_step('/input/reference.step')
pads = list(reference.solids())

# Circular-arc side profile, 8 mm vertical thickness and 10 mm width.
# The crown rises gently from Z=32 at the ends to Z=40 at midspan.
y_side = -5.0
upper_left = (-54.0, y_side, 32.0)
upper_mid = (0.0, y_side, 40.0)
upper_right = (54.0, y_side, 32.0)
lower_right = (54.0, y_side, 24.0)
lower_mid = (0.0, y_side, 32.0)
lower_left = (-54.0, y_side, 24.0)

outline = Wire([
    Edge.make_three_point_arc(upper_left, upper_mid, upper_right),
    Edge.make_line(upper_right, lower_right),
    Edge.make_three_point_arc(lower_right, lower_mid, lower_left),
    Edge.make_line(lower_left, upper_left),
])
grip_blank = Solid.extrude(Face(outline), (0.0, 10.0, 0.0))
# Round the grip separately so the supplied pads remain untouched.
grip = fillet(grip_blank.edges(), radius=1.5)

# Simple round supports on the frozen 96 mm mounting pitch.
# Both ends overlap adjoining material to form a continuous handle.
supports = [
    Solid.make_cylinder(
        radius=5.0,
        height=29.0,
        plane=Plane(origin=(x, 0.0, 1.0)),
    )
    for x in (-48.0, 48.0)
]

handle = grip.fuse(*supports, *pads)
export_step(handle, '/out/candidate.step')
