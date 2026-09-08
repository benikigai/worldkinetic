"""Trusted binary STL inspection using only Python's standard library."""
import hashlib
import math
import struct


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def segment_distance(point, a, b):
    delta = sub(b, a)
    length2 = dot(delta, delta)
    t = max(0, min(1, dot(sub(point, a), delta)/length2)) if length2 else 0
    return math.dist(point, tuple(x+t*d for x, d in zip(a, delta)))


def projected_distance(center, tri):
    points = [p[:2] for p in tri]
    signs = [(b[0]-a[0])*(center[1]-a[1])-(b[1]-a[1])*(center[0]-a[0])
             for a, b in zip(points, points[1:]+points[:1])]
    area = (points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0])
    if abs(area) > 1e-12 and (all(v >= 0 for v in signs) or all(v <= 0 for v in signs)):
        return 0.0
    return min(segment_distance(center, a, b) for a, b in zip(points, points[1:]+points[:1]))


def fit_circle(points):
    a = min(points)
    b = max(points, key=lambda p: math.dist(p, a))
    c = max(points, key=lambda p: abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])))
    ax, ay = a[:2]
    bx, by = b[:2]
    cx, cy = c[:2]
    determinant = 2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by))
    if abs(determinant) < 1e-9:
        raise ValueError("Rim does not establish a circle")
    aa, bb, cc = ax*ax+ay*ay, bx*bx+by*by, cx*cx+cy*cy
    center = ((aa*(by-cy)+bb*(cy-ay)+cc*(ay-by))/determinant,
              (aa*(cx-bx)+bb*(ax-cx)+cc*(bx-ax))/determinant)
    radius = math.dist(center, a[:2])
    residual = max(abs(math.dist(center, p[:2])-radius) for p in points)
    return center, radius, residual


def inspect_mesh(path, length, checked_bounds, checked_volume):
    data = path.read_bytes()
    diagnostics = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    try:
        if len(data) < 84:
            raise ValueError("Truncated binary STL")
        count = struct.unpack_from("<I", data, 80)[0]
        if not 0 < count <= 100000 or len(data) != 84+50*count:
            raise ValueError("Invalid STL length or triangle count")
        triangles, edge_uses = [], {}
        volume = 0.0
        for index in range(count):
            values = struct.unpack_from("<12fH", data, 84+50*index)
            if not all(math.isfinite(v) for v in values):
                raise ValueError("Nonfinite STL values")
            tri = [tuple(values[i:i+3]) for i in (3, 6, 9)]
            a, b, c = tri
            normal = cross(sub(b, a), sub(c, a))
            if dot(normal, normal) <= 1e-20:
                raise ValueError("Degenerate STL triangle")
            volume += dot(a, cross(b, c))/6
            triangles.append(tri)
            for a, b in zip(tri, tri[1:]+tri[:1]):
                edge_uses.setdefault(tuple(sorted((a, b))), []).append((index, a, b))
        adjacency = [set() for _ in triangles]
        for uses in edge_uses.values():
            if len(uses) != 2:
                raise ValueError("Mesh is not a closed two-manifold")
            (i, a, b), (j, c, d) = uses
            if a != d or b != c:
                raise ValueError("Inconsistent mesh orientation")
            adjacency[i].add(j)
            adjacency[j].add(i)
        seen, stack = set(), [0]
        while stack:
            i = stack.pop()
            if i not in seen:
                seen.add(i)
                stack.extend(adjacency[i]-seen)
        if len(seen) != count:
            raise ValueError("Disconnected mesh")
        vertices = {p for tri in triangles for p in tri}
        bb = [[min(p[i] for p in vertices) for i in range(3)], [max(p[i] for p in vertices) for i in range(3)]]
        relative = abs(volume-checked_volume)/checked_volume if checked_volume > 0 else None
        diagnostics.update({"triangles": count, "volume": volume, "bounds": bb, "relativeVolumeDifference": relative,
                            "closed": True, "consistentOrientation": True, "connected": True})
        if not math.isfinite(volume) or volume <= 0 or relative is None or relative > 0.001:
            raise ValueError("Mesh volume disagrees with checked solid")
        if any(abs(a-b) > 0.01 for p, q in zip(bb, checked_bounds) for a, b in zip(p, q)):
            raise ValueError("Mesh bounds disagree with checked solid")
        if len(vertices)-len(edge_uses)+count != -2:
            raise ValueError("Mesh topology does not contain exactly two handles")
        holes = []
        for expected in (((length-20)/2, 17.5), ((length+20)/2, 17.5)):
            wall = [i for i, tri in enumerate(triangles)
                    if all(abs(math.dist(p[:2], expected)-3) <= 0.01 for p in tri)
                    and max(p[2] for p in tri)-min(p[2] for p in tri) > 0.01]
            if not wall:
                raise ValueError("No full-height bore wall")
            wall_set = set(wall)
            rim_edges = [edge for edge, uses in edge_uses.items() if sum(i in wall_set for i, _, _ in uses) == 1]
            rims = []
            for z in (bb[0][2], bb[1][2]):
                edges = [e for e in rim_edges if all(abs(p[2]-z) <= 1e-6 for p in e)]
                points = {p for edge in edges for p in edge}
                if len(points) < 8 or len(edges) != len(points):
                    raise ValueError("Bore opening is incomplete")
                graph = {p: set() for p in points}
                for a, b in edges:
                    graph[a].add(b)
                    graph[b].add(a)
                if any(len(neighbors) != 2 for neighbors in graph.values()):
                    raise ValueError("Bore rim is not a simple closed loop")
                visited, pending = set(), [next(iter(points))]
                while pending:
                    p = pending.pop()
                    if p not in visited:
                        visited.add(p)
                        pending.extend(graph[p]-visited)
                if visited != points:
                    raise ValueError("Multiple bore rim loops")
                center, radius, residual = fit_circle(points)
                if math.dist(center, expected) > 0.01 or abs(2*radius-6) > 0.01 or residual > 0.01:
                    raise ValueError("Measured bore circle differs from required layout")
                # A simple rim must surround its measured axis once, with no
                # large missing arc hidden by a closing chord.
                angles = sorted(math.atan2(p[1]-center[1], p[0]-center[0]) for p in points)
                gaps = [b-a for a, b in zip(angles, angles[1:]+[angles[0]+2*math.pi])]
                if max(gaps) > 0.2:
                    raise ValueError("Bore rim coverage cannot establish circular opening")
                rims.append({"center": list(center), "diameter": radius*2, "z": z, "fitResidual": residual})
            if len(rim_edges) != sum(1 for e in rim_edges if any(all(abs(p[2]-z) <= 1e-6 for p in e) for z in (bb[0][2], bb[1][2]))):
                raise ValueError("Bore wall has an internal gap")
            if any(any(min(abs(p[2]-bb[0][2]), abs(p[2]-bb[1][2])) > 1e-6 for p in triangles[i]) for i in wall):
                diagnostics["reason"] = "Non-extruded bore wall requires an additional mesh section verifier"
                return "not_evaluated", diagnostics
            center = rims[0]["center"]
            minimum = min(projected_distance(center, tri) for tri in triangles)
            if minimum < 3-0.01:
                raise ValueError("A mesh triangle obstructs the full-height bore interior")
            holes.append({"rims": rims, "wallTriangles": len(wall), "minimumSurfaceRadius": minimum,
                          "fullHeightUnobstructed": True})
        pitch = math.dist(holes[0]["rims"][0]["center"], holes[1]["rims"][0]["center"])
        if abs(pitch-20) > 0.01:
            raise ValueError("Mesh bore pitch differs from requirement")
        diagnostics.update({"holes": holes, "pitch": pitch, "fullHeightBoreOpenings": True})
        return "passed", diagnostics
    except ValueError as exc:
        diagnostics["reason"] = str(exc)
        return "failed", diagnostics
