"""Trusted container entry point. Imports geometry only, never candidate source."""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform

from build123d import Align, Cylinder, Pos, export_stl, import_step
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane

from mesh_checks import inspect_mesh

TOL = 0.01
ROOT = Path("/input")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def xyz(point):
    return [point.X(), point.Y(), point.Z()]


def bounds(shape):
    b = shape.bounding_box()
    return [[b.min.X, b.min.Y, b.min.Z], [b.max.X, b.max.Y, b.max.Z]]


def volume(shape):
    return 0.0 if shape is None else shape.volume


def record(key, passed, method, measured, expected, units, scalar=None):
    value = {"checkId": key, "state": "passed" if passed else "failed", "method": method,
             "measured": measured, "expected": expected, "units": units}
    if scalar is not None:
        value["measuredValue"] = scalar
    return value


def close_bounds(a, b):
    return all(abs(x-y) <= TOL for p, q in zip(a, b) for x, y in zip(p, q))


def inspect_shape(shape, length):
    bb = bounds(shape)
    vol = shape.volume
    finite = all(math.isfinite(v) for p in bb for v in p) and math.isfinite(vol)
    solid_ok = finite and vol > 0 and shape.is_valid and len(shape.solids()) == 1
    planes, cylinders = [], []
    for face in shape.faces():
        surface = BRepAdaptor_Surface(face.wrapped, True)
        if surface.GetType() == GeomAbs_Plane:
            plane = surface.Plane()
            planes.append((face, xyz(plane.Location()), xyz(plane.Axis().Direction())))
        elif surface.GetType() == GeomAbs_Cylinder:
            cylinder = surface.Cylinder()
            cylinders.append((face, {"center": xyz(cylinder.Location())[:2], "radius": cylinder.Radius(),
                                     "axis": xyz(cylinder.Axis().Direction()), "bounds": bounds(face)}))
    expected_bounds = [[0, 0, 0], [length, 35, 5]]
    boundaries = []
    for axis, span in enumerate((length, 35, 5)):
        for target in (0, span):
            matches = [f for f, point, normal in planes
                       if abs(abs(normal[axis])-1) <= 1e-7 and abs(point[axis]-target) <= TOL
                       and all(abs(bounds(f)[j][k]-expected_bounds[j][k]) <= TOL
                               for j in (0, 1) for k in range(3) if k != axis)]
            boundaries.append(bool(matches))
    dimensions_ok = close_bounds(bb, expected_bounds) and all(boundaries)
    cylinders.sort(key=lambda item: item[1]["center"])
    expected_centers = [[(length-20)/2, 17.5], [(length+20)/2, 17.5]]
    holes = [data for _, data in cylinders]
    holes_ok = len(holes) == 2
    obstructions = []
    if holes_ok:
        for hole, center in zip(holes, expected_centers):
            holes_ok &= (abs(hole["radius"]*2-6) <= TOL
                         and all(abs(a-b) <= TOL for a, b in zip(hole["center"], center))
                         and abs(abs(hole["axis"][2])-1) <= 1e-7
                         and abs(hole["bounds"][0][2]-bb[0][2]) <= TOL
                         and abs(hole["bounds"][1][2]-bb[1][2]) <= TOL)
        holes_ok &= abs(math.dist(holes[0]["center"], holes[1]["center"])-20) <= TOL
    for center in expected_centers:
        # A tiny radial inset avoids coincident boundary topology. Any solid
        # intersection is obstruction, regardless of its volume, including plugs.
        probe = Pos(*center, bb[0][2]-1) * Cylinder(3-1e-7, bb[1][2]-bb[0][2]+2,
                                                  align=(Align.CENTER, Align.CENTER, Align.MIN))
        intersection = shape & probe
        count = 0 if intersection is None else len(intersection.solids())
        obstructions.append({"solidCount": count, "volumeMm3": volume(intersection)})
        holes_ok &= count == 0
    return {"bounds": bb, "volume": vol, "valid": bool(shape.is_valid), "solidCount": len(shape.solids()),
            "solidOK": bool(solid_ok), "dimensionsOK": bool(dimensions_ok), "boundaryPlanes": boundaries,
            "holesOK": bool(holes_ok), "holes": holes, "boreObstructions": obstructions}, cylinders, planes


def compare(a, b, length):
    am, _, _ = inspect_shape(a, length)
    bm, _, _ = inspect_shape(b, length)
    delta = volume(a-b) + volume(b-a)
    relative = abs(am["volume"]-bm["volume"])/am["volume"] if am["volume"] > 0 else None
    passed = (all(m["solidOK"] and m["dimensionsOK"] and m["holesOK"] for m in (am, bm))
              and close_bounds(am["bounds"], bm["bounds"]) and math.isfinite(delta) and delta <= 0.01
              and relative is not None and relative <= 1e-5)
    return passed, {"symmetricDifferenceMm3": delta, "relativeVolumeDifference": relative,
                    "candidate": am, "reopened": bm}


def main():
    config = json.loads((ROOT / "config.json").read_text())
    length = config["length"]
    for file, key in (("candidate.step", "geometryHash"), ("reference.step", "referenceSha256"),
                      ("regenerated.step", "regeneratedSha256")):
        if digest(ROOT / file) != config[key]:
            raise ValueError("Sealed input hash mismatch")
    shape = import_step(ROOT / "candidate.step")
    reference = import_step(ROOT / "reference.step")
    regenerated = import_step(ROOT / "regenerated.step")
    ref_measurement, _, _ = inspect_shape(reference, 50)
    if not all(ref_measurement[k] for k in ("solidOK", "dimensionsOK", "holesOK")):
        raise ValueError("Reference is not the registered plate geometry")
    measured, cylinders, planes = inspect_shape(shape, length)
    result = {"engine": {"version": importlib.metadata.version("build123d"),
                         "ocpVersion": importlib.metadata.version("cadquery-ocp-novtk")},
              "python": platform.python_version(), "reference": ref_measurement, "checks": []}
    checks = result["checks"]
    if not (ROOT / "checked.step").exists():
        regeneration_ok, regeneration_measurements = compare(shape, regenerated, length)
        result["regenerationComparison"] = {"passed": regeneration_ok, "measured": regeneration_measurements}
        checks.append(record("geometry.valid_single_solid", measured["solidOK"],
                             "Fresh STEP import; kernel topology validity, solid count, finite bounds and positive volume",
                             measured, {"valid": True, "solidCount": 1, "positiveFiniteVolume": True}, ["count", "mm", "mm3"],
                             measured["solidCount"]))
        checks.append(record("geometry.requested_dimensions", measured["dimensionsOK"],
                             "OCP analytic boundary planes and their actual face extents; independent bounding box",
                             {"bounds": measured["bounds"], "boundaryPlanes": measured["boundaryPlanes"]},
                             {"bounds": [[0, 0, 0], [length, 35, 5]], "linearTolerance": TOL}, "mm"))
        checks.append(record("holes.layout", measured["holesOK"],
                             "OCP analytic cylindrical faces, axes, diameter, centers, pitch and full-depth bounds; "
                             "full-height bore Boolean intersection must contain zero solids, with no volume allowance",
                             {"holes": measured["holes"], "obstructions": measured["boreObstructions"],
                              "probeRadialInsetMm": 1e-7},
                             {"centers": [[(length-20)/2, 17.5], [(length+20)/2, 17.5]], "diameter": 6,
                              "pitch": 20, "throughDepth": 5, "linearTolerance": TOL}, "mm"))
        pairs, distances = [], []
        if len(cylinders) == 2:
            for (cylinder, _), target in zip(cylinders, (measured["bounds"][0][0], measured["bounds"][1][0])):
                ends = [face for face, point, normal in planes
                        if abs(abs(normal[0])-1) <= 1e-7 and abs(point[0]-target) <= TOL]
                choices = []
                for end in ends:
                    distance = BRepExtrema_DistShapeShape(cylinder.wrapped, end.wrapped)
                    distance.Perform()
                    if distance.IsDone() and distance.NbSolution() > 0:
                        choices.append((distance.Value(), [xyz(distance.PointOnShape1(1)), xyz(distance.PointOnShape2(1))]))
                if choices:
                    distance, pair = min(choices, key=lambda item: item[0])
                    distances.append(distance)
                    pairs.append(pair)
        margin = min(distances) if len(distances) == 2 else None
        check = record("margin.end_material", margin is not None and margin+TOL >= 5,
                       "OCP BRepExtrema shortest cylinder-face to actual corresponding X end-face distance",
                       {"closestPointPairs": pairs, "distances": distances},
                       {"minimumEndMaterialMm": 5, "linearTolerance": TOL}, "mm", margin)
        if margin is None:
            check["state"] = "not_evaluated"
            check["measured"]["reason"] = "Two bore/end-face pairs could not be established"
        checks.append(check)
        export_stl(shape, "/out/preview.stl", tolerance=0.001, angular_tolerance=0.1)
    else:
        comparison_expected = {"symmetricDifferenceMm3Max": 0.01, "relativeVolumeMax": 1e-5, "linearToleranceMm": TOL}
        checked = import_step(ROOT / "checked.step")
        ok, diagnostics = compare(checked, shape, length)
        diagnostics["exportSha256"] = digest(ROOT / "candidate.step")
        diagnostics["checkedSha256"] = digest(ROOT / "checked.step")
        ok &= diagnostics["exportSha256"] == diagnostics["checkedSha256"] == config["geometryHash"]
        checks.append(record("export.step_reopen", ok,
                             "Reimport exact sealed STEP bytes in fresh export verifier; byte identity, bounds, holes, "
                             "positive valid solid, relative volume and bidirectional Boolean difference",
                             diagnostics, comparison_expected, ["mm", "mm3", "ratio", "SHA-256"],
                             diagnostics["symmetricDifferenceMm3"]))
        ok, diagnostics = compare(shape, regenerated, length)
        diagnostics.update({"sourceSha256": config["sourceSha256"], "regeneratedStepSha256": digest(ROOT / "regenerated.step")})
        checks.append(record("export.editable_reopen", ok,
                             "Independent isolated regeneration of same delivered source, sealed before trusted STEP imports; "
                             "validity, bounds, holes, relative volume and bidirectional Boolean difference; no native history claim",
                             diagnostics, comparison_expected, ["mm", "mm3", "ratio", "SHA-256"],
                             diagnostics["symmetricDifferenceMm3"]))
        state, diagnostics = inspect_mesh(ROOT / "preview.stl", length, measured["bounds"], measured["volume"])
        check = record("export.stl_reopen", state == "passed",
                       "Independent binary STL parse; exact edge pairing and opposite winding, connected triangle graph, "
                       "positive signed volume, bounds, fitted circular rims and full-height wall coverage; "
                       "every triangle tested for bore-interior obstruction",
                       diagnostics, {"linearToleranceMm": TOL, "relativeVolumeMax": 0.001, "maxTriangles": 100000,
                                     "closed": True, "connected": True, "unobstructedBores": True},
                       ["mm", "mm3", "ratio", "SHA-256"], diagnostics.get("volume"))
        check["state"] = state
        checks.append(check)
    Path("/out/measurement.json").write_text(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
