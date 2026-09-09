"""Trusted export failure classification; no Docker or CAD execution."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/tools'))
from cad_runner import trusted_export_failure
from handle_export import MeshTriangleLimitError, export_handle_stl_or_exit

class ExportFailure(unittest.TestCase):
    def test_trusted_export_boundary_emits_only_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with patch('handle_export.export_handle_stl', side_effect=MeshTriangleLimitError(102494)):
                with self.assertRaises(SystemExit) as raised:
                    export_handle_stl_or_exit(None, root/'preview.stl', root/'measurement.json')
            self.assertEqual(raised.exception.code, 86)
            self.assertEqual(set(json.loads((root/'measurement.json').read_text())), {'exportFailure'})
            self.assertEqual(trusted_export_failure('verifier', 86, root),
                             {'phase':'stl_tessellation','reason':'triangle_limit','triangles':102494,'limit':100000})
            for role in ('generator','regenerator','export_verifier'):
                self.assertIsNone(trusted_export_failure(role,86,root))
            self.assertIsNone(trusted_export_failure('verifier',1,root))

    def test_invalid_or_partial_evidence_does_not_classify(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.assertIsNone(trusted_export_failure('verifier',86,root))
            good={'phase':'stl_tessellation','reason':'triangle_limit','triangles':102494,'limit':100000}
            records=[{}, {'exportFailure':None}, {'exportFailure':good,'checks':[{'state':'passed'}]}]
            records += [{'exportFailure':{**good,**change}} for change in (
                {'triangles':100000}, {'triangles':True}, {'triangles':500001}, {'limit':100001}, {'reason':'other'})]
            for value in records:
                (root/'measurement.json').write_text(json.dumps(value))
                self.assertIsNone(trusted_export_failure('verifier',86,root),value)
            (root/'measurement.json').write_text('invalid json')
            self.assertIsNone(trusted_export_failure('verifier',86,root))

    def test_unrelated_errors_propagate(self):
        with patch('handle_export.export_handle_stl', side_effect=ValueError('another failure')):
            with self.assertRaises(ValueError):
                export_handle_stl_or_exit(None, 'unused', 'unused')

if __name__=='__main__':unittest.main()
