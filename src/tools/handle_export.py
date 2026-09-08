"""Bounded OCP tessellation; independent mesh acceptance remains mandatory."""
import struct
from pathlib import Path
from mesh_checks import cross, sub, dot


def strip_zero_area_triangles(path):
    path = Path(path)
    data = path.read_bytes()
    if len(data) < 84:
        raise ValueError('Truncated exported STL')
    count = struct.unpack_from('<I', data, 80)[0]
    if len(data) != 84 + 50 * count or count > 500000:
        raise ValueError('Invalid exported STL size')
    kept = []
    for i in range(count):
        record = data[84+50*i:134+50*i]
        values = struct.unpack('<12fH', record)
        tri = [tuple(values[j:j+3]) for j in (3, 6, 9)]
        normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        # Float32 sphere poles can collapse two vertices to exactly one point.
        # Remove only zero area, retaining every nonzero triangle for validation.
        if dot(normal, normal) != 0:
            kept.append(record)
    if not 0 < len(kept) <= 100000:
        raise ValueError('Exported mesh exceeds triangle limit')
    if len(kept) != count:
        path.write_bytes(data[:80] + struct.pack('<I', len(kept)) + b''.join(kept))
    return {'triangles': len(kept), 'zeroAreaTrianglesRemoved': count-len(kept)}


def export_handle_stl(shape, path):
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from build123d import Compound
    from OCP.BRepTools import BRepTools
    from OCP.IMeshTools import IMeshTools_Parameters
    from OCP.StlAPI import StlAPI_Writer

    BRepTools.Clean_s(shape.wrapped)
    parameters = IMeshTools_Parameters()
    parameters.Relative = False
    parameters.Deflection = 0.0001
    parameters.Angle = 0.1
    parameters.DeflectionInterior = 0.003
    parameters.AngleInterior = 0.1
    parameters.InParallel = False
    # Cache fine pad boundaries before meshing the grip at a lower density.
    # OCP shares these boundary polygons with adjacent faces; mesh checks still
    # independently require watertightness and the original dimensional limits.
    protected = [face for face in shape.faces() if face.bounding_box().max.Z <= 2.000001]
    if protected:
        pads = Compound(protected)
        first = BRepMesh_IncrementalMesh(pads.wrapped, parameters)
        if not first.IsDone():
            raise ValueError('Protected interface tessellation failed')
    parameters.Deflection = 0.001
    mesher = BRepMesh_IncrementalMesh(shape.wrapped, parameters)
    if not mesher.IsDone():
        raise ValueError('Handle tessellation failed')
    writer = StlAPI_Writer()
    writer.ASCIIMode = False
    if not writer.Write(shape.wrapped, str(path)):
        raise ValueError('Handle STL export failed')
    return strip_zero_area_triangles(path)
