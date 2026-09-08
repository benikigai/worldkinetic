"""Trusted handle measurements from reopened OCP geometry."""
import math
from build123d import Align, Box, Pos, Plane, section
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cylinder, GeomAbs_Plane
from OCP.gp import gp_Dir, gp_Pln, gp_Pnt

TOL = 0.01


def bounds(shape):
    if shape is None or not shape.vertices():
        return None
    b = shape.bounding_box()
    return [[b.min.X, b.min.Y, b.min.Z], [b.max.X, b.max.Y, b.max.Z]]


def volume(shape):
    return 0.0 if shape is None else sum(s.volume for s in shape.solids())


def difference(a, b):
    return None if volume(a) <= 0 else a if volume(b) <= 0 else a-b


def intersect(a, b):
    return None if volume(a) <= 0 else a & b


def box(x, y, z):
    return Pos(x[0], y[0], z[0]) * Box(x[1]-x[0], y[1]-y[0], z[1]-z[0], align=(Align.MIN, Align.MIN, Align.MIN))


def xyz(p):
    return [p.X(), p.Y(), p.Z()]


def panel_distance(central, cb):
    if central is None or cb is None:
        return None, []
    # Extend past the grip footprint so panel edges cannot set the minimum.
    panel = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)),
                                   cb[0][0]-1, cb[1][0]+1, cb[0][1]-1, cb[1][1]+1).Face()
    distance = BRepExtrema_DistShapeShape(central.wrapped, panel)
    distance.Perform()
    if not distance.IsDone() or distance.NbSolution() < 1:
        return None, []
    gap = distance.Value()
    pairs = [[xyz(distance.PointOnShape1(i)), xyz(distance.PointOnShape2(i))]
             for i in range(1, distance.NbSolution()+1)]
    if (not math.isfinite(gap) or gap < 0
            or any(not math.isfinite(v) for pair in pairs for point in pair for v in point)
            or any(abs(math.dist(*pair)-gap) > 1e-7 for pair in pairs)):
        return None, []
    return gap, pairs


def close_bounds(a, b, tolerance=TOL):
    return a is not None and b is not None and all(abs(x-y) <= tolerance for p, q in zip(a, b) for x, y in zip(p, q))


def solid_measurement(shape):
    bb, v = bounds(shape), volume(shape)
    count = 0 if shape is None else len(shape.solids())
    valid = shape is not None and bool(shape.is_valid)
    return {'bounds': bb, 'volumeMm3': v, 'solidCount': count, 'valid': valid,
            'passed': bool(valid and count == 1 and v > 0 and math.isfinite(v) and bb
                           and all(math.isfinite(v) for p in bb for v in p))}


def analytic_pads(shape, reference=False):
    contacts, cylinders = [], []
    for face in shape.faces():
        surface = BRepAdaptor_Surface(face.wrapped, True)
        if surface.GetType() == GeomAbs_Cylinder:
            c = surface.Cylinder()
            if abs(c.Radius()-7) <= TOL:
                cylinders.append({'radiusMm': c.Radius(), 'centerMm': xyz(c.Location()),
                                  'axis': xyz(c.Axis().Direction()), 'bounds': bounds(face)})
        elif surface.GetType() == GeomAbs_Plane:
            plane = surface.Plane()
            if abs(abs(plane.Axis().Direction().Z())-1) > 1e-7:
                continue
            if abs(plane.Location().Z()) > 1e-7 and not reference:
                continue
            if len(face.wires()) != 1 or len(face.edges()) != 1:
                continue
            curve = BRepAdaptor_Curve(face.edges()[0].wrapped)
            if curve.GetType() == GeomAbs_Circle:
                c = curve.Circle()
                contacts.append({'radiusMm': c.Radius(), 'centerMm': xyz(c.Location()), 'areaMm2': face.area})
    bottom = sorted([c for c in contacts if abs(c['centerMm'][2]) <= 1e-7], key=lambda c: c['centerMm'][0])
    good = len(bottom) == 2
    for c, x in zip(bottom, (-48, 48)):
        good &= (math.dist(c['centerMm'], [x, 0, 0]) <= TOL and abs(c['radiusMm']-7) <= TOL
                 and abs(c['areaMm2']-49*math.pi) <= TOL)
    axes = []
    for x in (-48, 48):
        matches = [c for c in cylinders if math.dist(c['centerMm'][:2], [x, 0]) <= TOL
                   and abs(abs(c['axis'][2])-1) <= 1e-7
                   and abs(c['bounds'][0][2]) <= TOL and c['bounds'][1][2] >= 2-TOL]
        good &= len(matches) == 1
        axes.extend(matches)
    pitch = math.dist(bottom[0]['centerMm'][:2], bottom[1]['centerMm'][:2]) if len(bottom) == 2 else None
    good &= pitch is not None and abs(pitch-96) <= TOL
    return {'passed': bool(good), 'contacts': bottom, 'axes': axes, 'mountPitchMm': pitch}


def reference_measurement(shape):
    pads = analytic_pads(shape, True)
    solids = sorted(shape.solids(), key=lambda s: s.bounding_box().min.X)
    good = bool(shape.is_valid) and len(solids) == 2 and pads['passed']
    for s, x in zip(solids, (-48, 48)):
        good &= close_bounds(bounds(s), [[x-7, -7, 0], [x+7, 7, 2]], 1e-5)
        good &= abs(s.volume-98*math.pi) < 1e-5 and len(s.faces()) == 3
    return {**pads, 'passed': bool(good), 'solidCount': len(solids), 'volumeMm3': volume(shape), 'bounds': bounds(shape)}


def stations(shape, xs):
    rows, faces = [], []
    for x in xs:
        cut = section(shape, section_by=Plane.YZ.offset(x)) if volume(shape) > 0 else None
        fs = [] if cut is None else [f for f in cut.faces() if f.area > 0]
        bb = bounds(cut)
        rows.append({'xMm': x, 'widthMm': bb[1][1]-bb[0][1] if bb else None,
                     'areaMm2': sum(f.area for f in fs), 'maxYMm': bb[1][1] if bb else None,
                     'minYMm': bb[0][1] if bb else None, 'faceCount': len(fs),
                     'valid': bool(cut is not None and cut.is_valid), 'bounds': bb})
        faces.append(cut)
    return rows, faces


def record(key, measured):
    return {'checkId': key, 'state': 'passed' if measured['passed'] else 'failed',
            'method': 'Independent reopened OCP geometry and planar Boolean measurements', 'measured': measured}


def inspect(shape, reference, g, baseline=None, initial=True):
    geometry = solid_measurement(shape)
    bb = geometry['bounds']
    pads = analytic_pads(shape)
    # Cover the whole candidate XY footprint, including material outside the envelope.
    layer = intersect(shape, box([min(-70, bb[0][0])-1, max(70, bb[1][0])+1],
                                 [min(-20, bb[0][1])-1, max(20, bb[1][1])+1], [0, 2]))
    pad_delta = volume(difference(layer, reference)) + volume(difference(reference, layer))
    mount = {**pads, 'symmetricDifferenceMm3': pad_delta, 'passed': pads['passed'] and pad_delta <= TOL}
    envelope = g['assumedEnvelopeMm']
    envelope_ok = all(envelope[k][0]-TOL <= bb[0][i] and bb[1][i] <= envelope[k][1]+TOL for i, k in enumerate(('x','y','z')))
    # Panel penetration has no positive-depth permission.
    env = {'bounds': bb, 'overallLengthMm': bb[1][0]-bb[0][0], 'diagnosticBounds': bb,
           'passed': envelope_ok and bb[0][2] >= -1e-7 and bb[1][0]-bb[0][0] <= 140+TOL}
    grip = g['grip']
    central = intersect(shape, box(grip['centralXRangeMm'], grip['centralYRangeMm'], grip['centralZRangeMm']))
    cb = bounds(central)
    gap, pairs = panel_distance(central, cb)
    intrusion = intersect(shape, box(grip['centralXRangeMm'], grip['centralYRangeMm'], [0, 25-1e-7]))
    intruding = [] if intrusion is None else [s for s in intrusion.solids() if s.volume > 0]
    clearance = {'minimumGapMm': gap, 'intersectingSolids': len(intruding), 'intrusionVolumeMm3': volume(intrusion),
                 'diagnosticBounds': bounds(intrusion), 'closestPointPairs': pairs,
                 'passed': gap is not None and gap >= 25-1e-7 and not intruding}
    rows, cuts = stations(central, grip['sectionStationsXmm'])
    sections_ok = central is not None and central.is_valid and len(central.solids()) == 1 and cb is not None and abs(cb[1][0]-cb[0][0]-60) <= TOL
    sections_ok &= all(row['faceCount'] == 1 and row['valid'] and row['areaMm2'] > 0 for row in rows)
    if initial:
        sections_ok &= cb is not None and cb[0][1] >= -7-TOL and cb[1][1] <= 7+TOL
        sections_ok &= all(row['widthMm'] is not None and 8-TOL <= row['widthMm'] <= 14+TOL for row in rows)
    sections = {'stations': rows, 'centralBounds': cb, 'centralSolidCount': 0 if central is None else len(central.solids()),
                'diagnosticBounds': cb, 'passed': bool(sections_ok)}
    checks = [record(k, m) for k, m in [('geometry.valid_single_solid', geometry), ('handle.mount_interface', mount),
              ('handle.envelope', env), ('handle.grip_clearance', clearance), ('handle.grip_sections', sections)]]
    if not initial:
        base_checks = inspect(baseline, reference, g, initial=True)
        base_ok = all(c['state'] == 'passed' for c in base_checks)
        base_rows, base_cuts = stations(baseline, grip['sectionStationsXmm'])
        delta_rows = []
        for row, base_row, cut, base_cut in zip(rows, base_rows, cuts, base_cuts):
            addition = None if cut is None else cut if base_cut is None else cut-base_cut
            added_area = 0 if addition is None else sum(f.area for f in addition.faces())
            delta_rows.append({**row, 'widthIncreaseMm': row['widthMm']-base_row['widthMm'] if row['widthMm'] is not None and base_row['widthMm'] is not None else None,
                               'addedAreaMm2': added_area})
        added, removed = difference(shape, baseline), difference(baseline, shape)
        thumb = g['refinement']['thumbRestBoxMm']
        thumb_added = intersect(added, box(thumb['x'], thumb['y'], thumb['z']))
        outer = max(rows[0]['maxYMm'], rows[-1]['maxYMm']) if rows[0]['maxYMm'] is not None and rows[-1]['maxYMm'] is not None else None
        protrusion = rows[2]['maxYMm']-outer if outer is not None and rows[2]['maxYMm'] is not None else None
        base_protrusion = base_rows[2]['maxYMm']-max(base_rows[0]['maxYMm'], base_rows[-1]['maxYMm']) if all(base_rows[i]['maxYMm'] is not None for i in (0,2,4)) else None
        increase = protrusion-base_protrusion if protrusion is not None and base_protrusion is not None else None
        boundary = max(thumb['y'][0], outer+1) if outer is not None else thumb['y'][1]
        outboard = intersect(added, box(thumb['x'], [boundary, thumb['y'][1]], thumb['z'])) if boundary < thumb['y'][1] else None
        delta_ok = (base_ok and volume(removed) <= TOL and volume(thumb_added) > 25 and volume(outboard) >= 5-1e-7
                    and protrusion is not None and protrusion >= 2-TOL and increase is not None and increase >= 2-TOL
                    and all(row['widthIncreaseMm'] is not None and row['widthIncreaseMm'] >= 4-TOL and row['addedAreaMm2'] >= 8-TOL for row in delta_rows))
        delta = {'stations': delta_rows, 'removedVolumeMm3': volume(removed), 'thumbAddedVolumeMm3': volume(thumb_added),
                 'outboardAddedVolumeMm3': volume(outboard), 'protrusionMm': protrusion, 'protrusionIncreaseMm': increase,
                 'baselineInitialChecks': base_checks, 'diagnosticBounds': bounds(removed) or bounds(thumb_added), 'passed': bool(delta_ok)}
        checks.append(record('handle.refinement_delta', delta))
    return checks


def compare(a, b, reference, g, baseline, initial):
    checks = inspect(b, reference, g, baseline, initial)
    delta = volume(difference(a, b)) + volume(difference(b, a))
    va, vb = volume(a), volume(b)
    relative = abs(va-vb)/va if va > 0 else None
    return {'passed': all(c['state'] == 'passed' for c in checks) and close_bounds(bounds(a), bounds(b)) and delta <= TOL
            and relative is not None and relative <= 1e-5, 'symmetricDifferenceMm3': delta,
            'relativeVolumeDifference': relative, 'reopenedChecks': checks}
