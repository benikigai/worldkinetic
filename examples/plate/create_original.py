"""Run through MCP inside FreeCAD; create and verify only a new test document."""

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import Part
import Mesh
import Import

root = Path(__file__).resolve().parent
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
output = root / "artifacts" / stamp
output.mkdir(parents=True, exist_ok=False)
doc = App.newDocument("WK_MCP_" + stamp)
doc.Label = "WorldKinetics MCP connection test"

base = doc.addObject("Part::Box", "BasePlate")
base.Length, base.Width, base.Height = 40, 30, 6
left = doc.addObject("Part::Cylinder", "LeftHole")
left.Radius = 3
left.setExpression("Height", "BasePlate.Height")
left.Placement.Base = App.Vector(10, 15, 0)
right = doc.addObject("Part::Cylinder", "RightHole")
right.Radius = 3
right.setExpression("Height", "BasePlate.Height")
right.Placement.Base = App.Vector(30, 15, 0)
first_cut = doc.addObject("Part::Cut", "FirstCut")
first_cut.Base, first_cut.Tool = base, left
plate = doc.addObject("Part::Cut", "FinishedPlate")
plate.Base, plate.Tool = first_cut, right
doc.recompute()

baseline_volume = plate.Shape.Volume
assert plate.Shape.isValid() and len(plate.Shape.Solids) == 1
assert math.isclose(baseline_volume, 40 * 30 * 6 - 2 * math.pi * 3**2 * 6, abs_tol=1e-6)

base.Height = 8
doc.recompute()
edited_volume = plate.Shape.Volume
assert plate.Shape.isValid() and len(plate.Shape.Solids) == 1
assert math.isclose(edited_volume, 40 * 30 * 8 - 2 * math.pi * 3**2 * 8, abs_tol=1e-6)
assert math.isclose(plate.Shape.BoundBox.ZLength, 8, abs_tol=1e-7)
assert math.isclose(left.Radius.Value, 3) and math.isclose(right.Radius.Value, 3)
for intermediate in (base, left, right, first_cut):
    intermediate.ViewObject.Visibility = False
plate.ViewObject.Visibility = True
plate.ViewObject.ShapeColor = (0.20, 0.55, 0.85)
Gui.activeDocument().activeView().viewAxonometric()
Gui.activeDocument().activeView().fitAll()

native = output / "mcp-test-plate.FCStd"
step = output / "mcp-test-plate.step"
stl = output / "mcp-test-plate.stl"
doc.saveAs(str(native))
Part.export([plate], str(step))
Mesh.export([plate], str(stl))

check_doc = App.newDocument("WK_STEP_check_" + stamp)
Import.insert(str(step), check_doc.Name)
check_doc.recompute()
imported = [o for o in check_doc.Objects if hasattr(o, "Shape") and not o.Shape.isNull() and len(o.Shape.Solids)]
assert len(imported) == 1
assert imported[0].Shape.isValid()
assert math.isclose(imported[0].Shape.Volume, edited_volume, abs_tol=1e-5)
step_volume = imported[0].Shape.Volume
App.closeDocument(check_doc.Name)

App.closeDocument(doc.Name)
doc = App.openDocument(str(native))
doc.recompute()
assert doc.getObject("FinishedPlate").Shape.isValid()
assert math.isclose(doc.getObject("FinishedPlate").Shape.Volume, edited_volume, abs_tol=1e-6)
assert math.isclose(doc.getObject("BasePlate").Height.Value, 8, abs_tol=1e-7)
App.setActiveDocument(doc.Name)
Gui.activeDocument().activeView().viewAxonometric()
Gui.activeDocument().activeView().fitAll()

report = {
    "status": "passed",
    "transport": "MCP Streamable HTTP, execute_python_file",
    "endpoint": "http://127.0.0.1:39280/mcp",
    "freecad_version": App.Version()[:3],
    "document": doc.Name,
    "units": "mm",
    "dimensions_mm": [40, 30, 8],
    "hole_diameters_mm": [6, 6],
    "baseline_thickness_mm": 6,
    "baseline_volume_mm3": baseline_volume,
    "edited_volume_mm3": edited_volume,
    "step_reopened_volume_mm3": step_volume,
    "checks": {"valid_single_solid": True, "analytical_volume_match": True, "parametric_edit": True, "step_reopened": True, "native_reopened": True},
    "artifacts": [{"path": str(p), "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in (native, step, stl)],
    "scope": "Connection test plate only; no product keycap, manufacturing, or physical-fit validation",
}
(output / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
