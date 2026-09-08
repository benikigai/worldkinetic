"""Protected independent acceptance probe; run only inside an isolated verifier.

This is acceptance setup, not the product reference generator. The host harness
must hold the shared CAD flock and supply the sealed reference as read-only input.
"""
import json
import math
from collections import defaultdict
from pathlib import Path
import struct

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
mesh = Path('/input/preview.stl').read_bytes()
assert len(mesh) >= 84
count = struct.unpack_from('<I', mesh, 80)[0]
assert 0 < count <= 100000 and len(mesh) == 84 + count * 50
edges, triangles = defaultdict(list), []
for i in range(count):
    values = struct.unpack_from('<12fH', mesh, 84 + i * 50)
    assert all(math.isfinite(v) for v in values[:-1])
    triangle = [tuple(values[j:j+3]) for j in (3, 6, 9)]
    assert len(set(triangle)) == 3
    triangles.append(triangle)
    for j in range(3):
        a, b = triangle[j], triangle[(j+1) % 3]
        edges[tuple(sorted((a, b)))].append((i, a, b))
adjacent = defaultdict(set)
for uses in edges.values():
    assert len(uses) == 2 and uses[0][1] == uses[1][2] and uses[0][2] == uses[1][1]
    a, b = uses[0][0], uses[1][0]
    adjacent[a].add(b)
    adjacent[b].add(a)
unseen, components = set(range(count)), []
while unseen:
    pending, component = [unseen.pop()], []
    while pending:
        index = pending.pop()
        component.append(index)
        for neighbor in adjacent[index] & unseen:
            unseen.remove(neighbor)
            pending.append(neighbor)
    components.append(component)
assert len(components) == 2, 'Reference STL must contain exactly two closed pad components'
components.sort(key=lambda c: min(p[0] for i in c for p in triangles[i]))
mesh_volumes = []
for component, expected_x in zip(components, (-48, 48)):
    points = [p for i in component for p in triangles[i]]
    bb = [min(p[j] for p in points) for j in range(3)] + [max(p[j] for p in points) for j in range(3)]
    for actual, expected in zip(bb, (expected_x-7, -7, 0, expected_x+7, 7, 2)):
        near(actual, expected, 0.01)
    signed = 0
    for i in component:
        a, b, c = triangles[i]
        signed += (a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6
    assert signed > 0 and abs(signed - 98*math.pi) / (98*math.pi) <= 0.001
    mesh_volumes.append(signed)
Path('/out/measurement.json').write_text(json.dumps({
    'scope': 'independent trusted two-pad reference acceptance',
    'solidCount': len(solids), 'volumeMm3': shape.volume, 'mountPitchMm': pitch,
    'pads': observed, 'containsHandle': False,
    'mesh': {'components': len(components), 'triangles': count, 'componentVolumesMm3': mesh_volumes,
             'watertight': True, 'consistentlyOriented': True},
}, allow_nan=False))
