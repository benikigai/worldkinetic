"""Exercise the production delta decision with controlled measured volumes.

This host-only check compiles the actual delta_ok expression without importing
OCP or generating geometry. All independent prerequisites are satisfied so the
outboard minimum is isolated. Real CAD boundary tests remain separate.
"""
import ast
import math
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[2] / 'src/tools/handle_geometry.py'
module = ast.parse(source.read_text())
assignments = [n for n in ast.walk(module) if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Name) and t.id == 'delta_ok' for t in n.targets)]
if len(assignments) != 1:
    raise AssertionError('Expected one production refinement delta decision')
expression = compile(ast.Expression(assignments[0].value), str(source), 'eval')

class OutboardMinimum(unittest.TestCase):
    def test_finite_measured_volume_uses_exact_inclusive_minimum(self):
        for measured, expected in [(4.995, False), (5-5e-8, False),
                                   (math.nextafter(5, -math.inf), False), (5.0, True),
                                   (5.001, True), (math.nan, False),
                                   (math.inf, False), (-math.inf, False)]:
            with self.subTest(measured=measured):
                scope = dict(math=math, base_ok=True, volume=lambda v: v, removed=0.0,
                             thumb_added=100.0, outboard=measured, protrusion=3.0,
                             increase=3.0, TOL=0.01,
                             delta_rows=[{'widthIncreaseMm':4.0, 'addedAreaMm2':8.0}])
                self.assertEqual(bool(eval(expression, scope)), expected)

if __name__ == '__main__':
    unittest.main()
