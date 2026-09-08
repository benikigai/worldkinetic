from build123d import *

# Retain the exact accepted handle, including both mounting pads.
baseline = import_step('/input/baseline.step')

# Original circular arch, with its original 8 mm vertical thickness.
y = -7.0
arch_wire = Wire([
    Edge.make_three_point_arc((-54, y, 32), (0, y, 40), (54, y, 32)),
    Edge.make_line((54, y, 32), (54, y, 24)),
    Edge.make_three_point_arc((54, y, 24), (0, y, 32), (-54, y, 24)),
    Edge.make_line((-54, y, 24), (-54, y, 32)),
])
arch_blank = Solid.extrude(Face(arch_wire), (0, 20, 0))

# A 14 mm wide planform with a smoothly blended, one-sided thumb rest.
# The Bezier roots and crown have horizontal tangents and zero curvature
# at their joins to the straight sidewall and to each other.
plan_wire = Wire([
    Edge.make_line((-54, -7, 0), (54, -7, 0)),
    Edge.make_line((54, -7, 0), (54, 7, 0)),
    Edge.make_line((54, 7, 0), (22, 7, 0)),
    Edge.make_bezier(
        (22, 7, 0), (16, 7, 0), (12, 7, 0),
        (8, 12, 0), (4, 12, 0), (0, 12, 0)
    ),
    Edge.make_bezier(
        (0, 12, 0), (-4, 12, 0), (-8, 12, 0),
        (-12, 7, 0), (-16, 7, 0), (-22, 7, 0)
    ),
    Edge.make_line((-22, 7, 0), (-54, 7, 0)),
    Edge.make_line((-54, 7, 0), (-54, -7, 0)),
])
plan_blank = Solid.extrude(Face(plan_wire), (0, 0, 50))

# Trim both the grip and thumb rest to the same upper and lower arches,
# then retain the original edge-rounding radius.
widened_blank = arch_blank.intersect(plan_blank)
widened_grip = fillet(widened_blank.edges(), radius=1.5)
handle = baseline.fuse(widened_grip)
export_step(handle, '/out/candidate.step')
