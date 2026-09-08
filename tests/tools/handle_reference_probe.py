"""Protected independent acceptance probe; run only inside an isolated verifier.

This is acceptance setup, not the product reference generator. The host harness
must hold the shared CAD flock and supply the sealed reference as read-only input.
"""
import json
import math
from pathlib import Path

from build123d import import_step
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cylinder, GeomAbs_Plane


def xyz(p):
    return [p.X(), p.Y(), p.Z()]


def near(actual, expected, tolerance=0.00001):
    assert abs(actual - expected) <= tolerance, (actual, expected)


shape = import_step('/input/reference.step')
solids = sorted(shape.solids(), key=lambda s: s.bounding_box().min.X)
assert len(solids) == 2, 'Trusted reference must have only two pads, not a handle'
observed = []
for solid, expected_x in zip(solids, (-48, 48)):
    assert solid.is_valid
    near(solid.volume, 98 * math.pi)
    bb = solid.bounding_box()
    for actual, expected in zip((bb.min.X, bb.min.Y, bb.min.Z, bb.max.X, bb.max.Y, bb.max.Z),
                                (expected_x - 7, -7, 0, expected_x + 7, 7, 2)):
        near(actual, expected)
    cylinders, contacts = [], []
    for face in solid.faces():
        surface = BRepAdaptor_Surface(face.wrapped, True)
        if surface.GetType() == GeomAbs_Cylinder:
            c = surface.Cylinder()
            center, direction = xyz(c.Location()), xyz(c.Axis().Direction())
            near(c.Radius(), 7)
            near(center[0], expected_x)
            near(center[1], 0)
            near(abs(direction[2]), 1)
            cylinders.append({'center': center, 'radius': c.Radius(), 'axis': direction})
        elif surface.GetType() == GeomAbs_Plane:
            plane = surface.Plane()
            near(abs(plane.Axis().Direction().Z()), 1)
            near(face.area, 49 * math.pi)
            assert len(face.wires()) == 1 and len(face.edges()) == 1
            curve = BRepAdaptor_Curve(face.edges()[0].wrapped)
            assert curve.GetType() == GeomAbs_Circle
            circle = curve.Circle()
            near(circle.Radius(), 7)
            center = xyz(circle.Location())
            near(center[0], expected_x)
            near(center[1], 0)
            assert min(abs(center[2]), abs(center[2] - 2)) <= 0.00001
            contacts.append({'center': center, 'radius': circle.Radius(), 'area': face.area})
        else:
            raise AssertionError('Unexpected geometry in the two-pad reference')
    assert len(cylinders) == 1 and len(contacts) == 2
    assert sorted(round(c['center'][2], 5) for c in contacts) == [0, 2]
    observed.append({'volumeMm3': solid.volume, 'cylinders': cylinders, 'contacts': contacts})
pitch = abs(observed[1]['cylinders'][0]['center'][0] - observed[0]['cylinders'][0]['center'][0])
near(pitch, 96)
near(shape.volume, 196 * math.pi)
Path('/out/measurement.json').write_text(json.dumps({
    'scope': 'independent trusted two-pad reference acceptance',
    'solidCount': len(solids), 'volumeMm3': shape.volume, 'mountPitchMm': pitch,
    'pads': observed, 'containsHandle': False,
}, allow_nan=False))
