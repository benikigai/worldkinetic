"""Independent binary STL topology, clipping and planar section measurements."""
import hashlib
import math
import struct
from mesh_checks import cross, sub, dot, fit_circle


def clip(poly, axis, bound, keep_above):
    result = []
    for a, b in zip(poly, poly[1:]+poly[:1]):
        da, db = a[axis]-bound, b[axis]-bound
        ina, inb = (da >= 0, db >= 0) if keep_above else (da <= 0, db <= 0)
        if ina:
            result.append(a)
        if ina != inb:
            t = da/(da-db)
            result.append(tuple(a[i]+t*(b[i]-a[i]) for i in range(3)))
    return result


def clipped(tri, ranges):
    poly = tri
    for axis, (lo, hi) in enumerate(ranges):
        if not poly:
            break
        poly = clip(clip(poly, axis, lo, True), axis, hi, False)
    return poly


def layer_volume(triangles, lo, hi):
    # Divergence theorem with Fz=clamp(z-lo,0,hi-lo); no fitted solid or CAD export is trusted.
    total = 0.0
    for tri in triangles:
        middle = clip(clip(tri, 2, lo, True), 2, hi, False)
        above = clip(tri, 2, hi, True) if max(p[2] for p in tri) > hi else []
        for poly, constant in ((middle, None), (above, hi-lo)):
            for i in range(1, len(poly)-1):
                a, b, c = poly[0], poly[i], poly[i+1]
                nz = cross(sub(b, a), sub(c, a))[2]/2
                fz = constant if constant is not None else (a[2]+b[2]+c[2])/3-lo
                total += nz*fz
    return total


def section_metrics(triangles, x):
    segments = {}
    signed_area = 0
    for tri in triangles:
        points = []
        for a, b in zip(tri, tri[1:]+tri[:1]):
            if (a[0] <= x < b[0]) or (b[0] <= x < a[0]):
                t = (x-a[0])/(b[0]-a[0])
                points.append((x, a[1]+t*(b[1]-a[1]), a[2]+t*(b[2]-a[2])))
        if len(points) != 2 or math.dist(*points) < 1e-9:
            continue
        a, b = points
        normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        direction = cross((1, 0, 0), normal)
        if dot(sub(b, a), direction) < 0:
            a, b = b, a
        signed_area += (a[1]*b[2]-b[1]*a[2])/2
        key = tuple(sorted((tuple(round(v, 6) for v in a), tuple(round(v, 6) for v in b))))
        segments[key] = (a, b)
    adjacency = {}
    for a, b in segments:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
    if not adjacency or any(len(v) != 2 for v in adjacency.values()):
        raise ValueError('Mesh section does not establish closed planar contours')
    unseen, components = set(adjacency), 0
    while unseen:
        pending = [unseen.pop()]
        components += 1
        while pending:
            v = pending.pop()
            for n in adjacency[v] & unseen:
                unseen.remove(n)
                pending.append(n)
    points = [p for edge in segments.values() for p in edge]
    return {'xMm': x, 'widthMm': max(p[1] for p in points)-min(p[1] for p in points),
            'areaMm2': abs(signed_area), 'maxYMm': max(p[1] for p in points), 'contourCount': components}


def inspect_mesh(path, checked, reference_only=False, step_checks=None):
    data = path.read_bytes()
    result = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'passed': False}
    if len(data) < 84:
        raise ValueError('Truncated STL')
    count = struct.unpack_from('<I', data, 80)[0]
    if not 0 < count <= 100000 or len(data) != 84+50*count:
        raise ValueError('Invalid STL size or triangle count')
    triangles, edges, volumes = [], {}, []
    for i in range(count):
        values = struct.unpack_from('<12fH', data, 84+50*i)
        if not all(math.isfinite(v) for v in values):
            raise ValueError('Nonfinite STL')
        tri = [tuple(values[j:j+3]) for j in (3, 6, 9)]
        normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        if dot(normal, normal) <= 1e-20:
            raise ValueError('Degenerate STL')
        triangles.append(tri)
        volumes.append(dot(tri[0], cross(tri[1], tri[2]))/6)
        for a, b in zip(tri, tri[1:]+tri[:1]):
            edges.setdefault(tuple(sorted((a, b))), []).append((i, a, b))
    adjacency = [set() for _ in triangles]
    for uses in edges.values():
        if len(uses) != 2:
            raise ValueError('Nonwatertight STL')
        (i,a,b), (j,c,d) = uses
        if a != d or b != c:
            raise ValueError('Inconsistent STL winding')
        adjacency[i].add(j)
        adjacency[j].add(i)
    unseen, components = set(range(count)), []
    while unseen:
        pending, component = [unseen.pop()], []
        while pending:
            i = pending.pop()
            component.append(i)
            for j in adjacency[i] & unseen:
                unseen.remove(j)
                pending.append(j)
        components.append(component)
    component_volumes = [sum(volumes[i] for i in c) for c in components]
    pts = [p for tri in triangles for p in tri]
    bb = [[min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]]
    vol = sum(volumes)
    relative = abs(vol-checked['volumeMm3'])/checked['volumeMm3'] if checked['volumeMm3'] > 0 else None
    good = (len(components) == (2 if reference_only else 1) and all(v > 0 for v in component_volumes)
            and relative is not None and relative <= 0.001
            and all(abs(a-b) <= 0.01 for p,q in zip(bb, checked['bounds']) for a,b in zip(p,q)))
    contacts, contact_edges = [], {}
    for tri in triangles:
        if all(abs(p[2]) <= 1e-7 for p in tri):
            for a,b in zip(tri, tri[1:]+tri[:1]):
                key = tuple(sorted((a,b)))
                contact_edges[key] = contact_edges.get(key,0)+1
    rim_edges = [edge for edge,n in contact_edges.items() if n == 1]
    for x in (-48,48):
        points = {p for edge in rim_edges for p in edge if abs(p[0]-x) < 10}
        if len(points) < 8:
            good = False
            continue
        center, radius, residual = fit_circle(points)
        contacts.append({'centerMm': list(center), 'radiusMm': radius, 'radialResidualMm': residual})
        good &= math.dist(center, [x,0]) <= 0.01 and abs(radius-7) <= 0.01 and residual <= 0.01
    good &= len(contacts) == 2 and all(any(abs(p[0]-x) < 10 for x in (-48,48)) for edge in rim_edges for p in edge)
    layer_points = [p for tri in triangles for p in clipped(tri, [[bb[0][0]-1,bb[1][0]+1], [bb[0][1]-1,bb[1][1]+1], [0,2]])]
    layer_ok = all(min(math.hypot(p[0]-x,p[1]) for x in (-48,48)) <= 7+0.01 for p in layer_points)
    contact_volume = layer_volume(triangles, 0, 2)
    contact_delta = abs(contact_volume-196*math.pi)
    good &= layer_ok and contact_delta <= 0.01
    result.update({'triangles': count, 'components': len(components), 'componentVolumesMm3': component_volumes,
                   'volumeMm3': vol, 'bounds': bb, 'relativeVolumeDifference': relative,
                   'watertight': True, 'consistentlyOriented': True, 'contacts': contacts, 'contactLayerWithinPads': layer_ok,
                   'contactLayerVolumeMm3': contact_volume, 'contactLayerVolumeDifferenceMm3': contact_delta})
    if reference_only:
        for component in components:
            ps = [p for i in component for p in triangles[i]]
            x = -48 if sum(p[0] for p in ps)/len(ps) < 0 else 48
            component_bounds = [[min(p[i] for p in ps) for i in range(3)], [max(p[i] for p in ps) for i in range(3)]]
            target = [[x-7,-7,0],[x+7,7,2]]
            good &= all(abs(a-b) <= 0.01 for p,q in zip(component_bounds,target) for a,b in zip(p,q))
            good &= abs(sum(volumes[i] for i in component)-98*math.pi)/(98*math.pi) <= 0.001
            good &= all(-1e-7 <= p[2] <= 2+1e-7 and math.hypot(p[0]-x,p[1]) <= 7+0.01 for p in ps)
    else:
        central = [p for tri in triangles for p in clipped(tri, [[-30,30],[-20,20],[0,50]])]
        gap = min(p[2] for p in central) if central else None
        good &= gap is not None and gap >= 25-1e-7 and bb[0][2] >= -1e-7
        result['minimumGapMm'] = gap
        measured = {c['checkId']: c['measured'] for c in step_checks}
        rows = []
        try:
            rows = [section_metrics(triangles, x) for x in (-24,-12,0,12,24)]
            for actual, expected in zip(rows, measured['handle.grip_sections']['stations']):
                good &= expected['widthMm'] is not None and abs(actual['widthMm']-expected['widthMm']) <= 0.01
                good &= abs(actual['areaMm2']-expected['areaMm2']) <= 0.01
                good &= expected['maxYMm'] is not None and abs(actual['maxYMm']-expected['maxYMm']) <= 0.01
        except ValueError as exc:
            good = False
            result['sectionReason'] = str(exc)
        result['stations'] = rows
        good &= all(c['state'] == 'passed' for c in step_checks)
    result['passed'] = bool(good)
    return result
