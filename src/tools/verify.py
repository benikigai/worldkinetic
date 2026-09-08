"""Trusted container entry point. Imports geometry only, never candidate source."""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform

from build123d import Align, Box, Cylinder, Pos, export_stl, import_step
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


def difference(a, b):
    # Empty Boolean intersections are None in this kernel binding.
    if volume(a) <= 0:
        return None
    return a if volume(b) <= 0 else a-b


def record(key, passed, method, measured, expected, units, scalar=None):
    value = {"checkId": key, "state": "passed" if passed else "failed", "method": method,
             "measured": measured, "expected": expected, "units": units}
    if scalar is not None:
        value["measuredValue"] = scalar
    return value


def close_bounds(a, b):
    return all(abs(x-y) <= TOL for p, q in zip(a, b) for x, y in zip(p, q))


def inspect_shape(shape, length, reference=None):
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
    base_measurement = None
    total_bounds = [[0, 0, 0], [length, 35, 7 if reference is not None else 5]]
    if reference is not None:
        # Clip the entire candidate base layer, not a generator-declared region.
        lo = [min(0, bb[0][i]) - 1 for i in (0, 1)]
        hi = [max((50, 35)[i], bb[1][i]) + 1 for i in (0, 1)]
        slab = Pos(*lo, 0) * Box(hi[0]-lo[0], hi[1]-lo[1], 5, align=(Align.MIN, Align.MIN, Align.MIN))
        base = shape & slab
        base_bounds = bounds(base) if volume(base) > 0 else None
        base_delta = volume(difference(reference, base)) + volume(difference(base, reference))
        base_measurement = {"bounds": base_bounds, "symmetricDifferenceMm3": base_delta,
                            "baseThicknessMm": base_bounds[1][2]-base_bounds[0][2] if base_bounds else None,
                            "sectionRangeMm": [0, 5]}
    dimensions_ok = close_bounds(bb, total_bounds) and all(boundaries)
    if base_measurement is not None:
        dimensions_ok &= (base_measurement["bounds"] is not None
                          and close_bounds(base_measurement["bounds"], expected_bounds)
                          and base_measurement["symmetricDifferenceMm3"] <= TOL)
    expected_centers = [[(length-20)/2, 17.5], [(length+20)/2, 17.5]]
    # Rounded additions can contain other analytic cylinders. Identify only
    # required bore surfaces; their rims end at the base top, not feature top.
    cylinders = [(face, data) for face, data in cylinders
                 if any(math.dist(data["center"], center) <= TOL for center in expected_centers)
                 and abs(data["radius"]*2-6) <= TOL and abs(abs(data["axis"][2])-1) <= 1e-7]
    cylinders.sort(key=lambda item: item[1]["center"])
    holes = [data for _, data in cylinders]
    holes_ok = len(holes) == 2
    obstructions = []
    if holes_ok:
        for hole, center in zip(holes, expected_centers):
            holes_ok &= (abs(hole["radius"]*2-6) <= TOL
                         and all(abs(a-b) <= TOL for a, b in zip(hole["center"], center))
                         and abs(abs(hole["axis"][2])-1) <= 1e-7
                         and abs(hole["bounds"][0][2]) <= TOL
                         and abs(hole["bounds"][1][2]-5) <= TOL)
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
            "baseLayer": base_measurement, "holesOK": bool(holes_ok), "holes": holes, "boreObstructions": obstructions}, cylinders, planes


def compare(a, b, length, reference=None):
    am, _, _ = inspect_shape(a, length, reference)
    bm, _, _ = inspect_shape(b, length, reference)
    delta = volume(difference(a, b)) + volume(difference(b, a))
    relative = abs(am["volume"]-bm["volume"])/am["volume"] if am["volume"] > 0 else None
    passed = (all(m["solidOK"] and m["dimensionsOK"] and m["holesOK"] for m in (am, bm))
              and close_bounds(am["bounds"], bm["bounds"]) and math.isfinite(delta) and delta <= 0.01
              and relative is not None and relative <= 1e-5)
    return passed, {"symmetricDifferenceMm3": delta, "relativeVolumeDifference": relative,
                    "candidate": am, "reopened": bm}


def defect_diagnostics(defect, target):
    if volume(defect) <= 0:
        return None, []
    # Actual points on the defect and the corresponding nearest target surface.
    pairs = []
    for vertex in defect.vertices():
        distance = BRepExtrema_DistShapeShape(vertex.wrapped, target.wrapped)
        distance.Perform()
        if distance.IsDone() and distance.NbSolution() > 0:
            pairs.append((distance.Value(), [xyz(distance.PointOnShape1(1)), xyz(distance.PointOnShape2(1))]))
    return bounds(defect), [pair for _, pair in sorted(pairs, key=lambda item: -item[0])[:8]]


def inspect_feature(shape, reference, measured, setup):
    feature = setup["feature"]
    added, removed = difference(shape, reference), difference(reference, shape)
    added_volume, removed_volume = volume(added), volume(removed)
    added_bounds = bounds(added) if added_volume > 0 else None
    spans = [hi-lo for lo, hi in zip(*added_bounds)] if added_bounds else None
    allowed_ranges = feature["allowedBoxMm"]
    allowed = Pos(*(r[0] for r in allowed_ranges)) * Box(*(r[1]-r[0] for r in allowed_ranges),
                                                          align=(Align.MIN, Align.MIN, Align.MIN))
    outside = difference(added, allowed)
    outside_volume = volume(outside)
    feature_ok = (added_volume > feature["minimumAddedVolumeExclusiveMm3"] and spans is not None
                  and all(lo-TOL <= value <= hi+TOL for value, (lo, hi) in zip(spans, feature["addedSpanRangesMm"]))
                  and outside_volume <= TOL and removed_volume <= TOL and measured["solidOK"])
    box, pairs = defect_diagnostics(outside, allowed)
    if box is None:
        box, pairs = defect_diagnostics(removed, shape)
    feature_check = record("feature.requested_change", feature_ok,
                           "Boolean candidate-minus-reference addition, independent bounds/spans, outside-box and removed volumes",
                           {"addedVolumeMm3": added_volume, "addedBounds": added_bounds, "addedSpansMm": spans,
                            "outsideVolumeMm3": outside_volume, "removedVolumeMm3": removed_volume,
                            "connectedValidSolid": measured["solidOK"], "closestPointPairs": pairs,
                            "diagnosticBounds": box if box is not None else added_bounds}, feature, ["mm", "mm3"])
    regions = []
    protected = setup["protectedRegions"]
    for center in protected["centersMm"]:
        lo, hi = protected["zRangeMm"]
        region = Pos(*center, lo) * Cylinder(protected["radiusMm"], hi-lo,
                                            align=(Align.CENTER, Align.CENTER, Align.MIN))
        before, after = reference & region, shape & region
        delta = volume(difference(before, after)) + volume(difference(after, before))
        regions.append({"centerMm": center, "radiusMm": protected["radiusMm"], "zRangeMm": [lo, hi],
                        "symmetricDifferenceMm3": delta, "baselineVolumeMm3": volume(before),
                        "candidateVolumeMm3": volume(after)})
    box, pairs = defect_diagnostics(removed, shape)
    protected_ok = all(r["symmetricDifferenceMm3"] <= TOL for r in regions) and removed_volume <= TOL and measured["holesOK"]
    protected_check = record("interface.protected_region", protected_ok,
                             "Clipped reference/candidate symmetric differences in frozen protected cylinders; whole-baseline removal and full-height bore probes",
                             {"regions": regions, "removedVolumeMm3": removed_volume,
                              "boreObstructions": measured["boreObstructions"], "closestPointPairs": pairs,
                              "diagnosticBounds": box}, protected, ["mm3", "mm"])
    return [protected_check, feature_check]


def main():
    config = json.loads((ROOT / "config.json").read_text())
    length = config["length"]
    requirements = None
    if (ROOT / "requirements.json").exists():
        from requirements_binding import validate_binding
        requirements = validate_binding((ROOT / "requirements.json").read_bytes(), length, config["referenceSha256"])
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
    feature_reference = reference if requirements and requirements["setupId"] == "tactile_feature_v1" else None
    if config.get("setupId", "resize_centered_v1") == "tactile_feature_v1" and feature_reference is None:
        raise ValueError("Feature verification requires frozen requirements")
    measured, cylinders, planes = inspect_shape(shape, length, feature_reference)
    result = {"engine": {"version": importlib.metadata.version("build123d"),
                         "ocpVersion": importlib.metadata.version("cadquery-ocp-novtk")},
              "python": platform.python_version(), "reference": ref_measurement, "checks": []}
    checks = result["checks"]
    if not (ROOT / "checked.step").exists():
        regeneration_ok, regeneration_measurements = compare(shape, regenerated, length, feature_reference)
        result["regenerationComparison"] = {"passed": regeneration_ok, "measured": regeneration_measurements}
        checks.append(record("geometry.valid_single_solid", measured["solidOK"],
                             "Fresh STEP import; kernel topology validity, solid count, finite bounds and positive volume",
                             measured, {"valid": True, "solidCount": 1, "positiveFiniteVolume": True}, ["count", "mm", "mm3"],
                             measured["solidCount"]))
        checks.append(record("geometry.requested_dimensions", measured["dimensionsOK"],
                             "OCP analytic boundary planes and their actual face extents; independent bounding box",
                             {"bounds": measured["bounds"], "boundaryPlanes": measured["boundaryPlanes"], "baseLayer": measured["baseLayer"]},
                             {"bounds": [[0, 0, 0], [length, 35, 7 if feature_reference is not None else 5]], "baseThicknessMm": 5, "linearTolerance": TOL}, "mm"))
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
        if feature_reference is not None:
            checks.extend(inspect_feature(shape, reference, measured, requirements["setup"]))
        export_stl(shape, "/out/preview.stl", tolerance=0.001, angular_tolerance=0.1)
    else:
        comparison_expected = {"symmetricDifferenceMm3Max": 0.01, "relativeVolumeMax": 1e-5, "linearToleranceMm": TOL}
        checked = import_step(ROOT / "checked.step")
        ok, diagnostics = compare(checked, shape, length, feature_reference)
        diagnostics["exportSha256"] = digest(ROOT / "candidate.step")
        diagnostics["checkedSha256"] = digest(ROOT / "checked.step")
        ok &= diagnostics["exportSha256"] == diagnostics["checkedSha256"] == config["geometryHash"]
        checks.append(record("export.step_reopen", ok,
                             "Reimport exact sealed STEP bytes in fresh export verifier; byte identity, bounds, holes, "
                             "positive valid solid, relative volume and bidirectional Boolean difference",
                             diagnostics, comparison_expected, ["mm", "mm3", "ratio", "SHA-256"],
                             diagnostics["symmetricDifferenceMm3"]))
        ok, diagnostics = compare(shape, regenerated, length, feature_reference)
        diagnostics.update({"sourceSha256": config["sourceSha256"], "regeneratedStepSha256": digest(ROOT / "regenerated.step")})
        checks.append(record("export.editable_reopen", ok,
                             "Independent isolated regeneration of same delivered source, sealed before trusted STEP imports; "
                             "validity, bounds, holes, relative volume and bidirectional Boolean difference; no native history claim",
                             diagnostics, comparison_expected, ["mm", "mm3", "ratio", "SHA-256"],
                             diagnostics["symmetricDifferenceMm3"]))
        addition = difference(shape, feature_reference) if feature_reference is not None else None
        added_bounds = bounds(addition) if volume(addition) > 0 else None
        state, diagnostics = inspect_mesh(ROOT / "preview.stl", length, measured["bounds"], measured["volume"],
                                           feature=feature_reference is not None, feature_bounds=added_bounds)
        check = record("export.stl_reopen", state == "passed",
                       "Independent binary STL parse; exact edge pairing and opposite winding, connected triangle graph, "
                       "positive signed volume, bounds, fitted circular rims and full-height wall coverage; "
                       "every triangle tested for bore-interior obstruction",
                       diagnostics, {"linearToleranceMm": TOL, "relativeVolumeMax": 0.001, "maxTriangles": 100000,
                                     "closed": True, "connected": True, "unobstructedBores": True},
                       ["mm", "mm3", "ratio", "SHA-256"], diagnostics.get("volume"))
        if state == "passed" and not (measured["dimensionsOK"] and measured["holesOK"]):
            state = "failed"
            diagnostics["reason"] = "Reopened mesh agrees with candidate but required dimensions or holes fail"
        check["state"] = state
        checks.append(check)
    Path("/out/measurement.json").write_text(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
