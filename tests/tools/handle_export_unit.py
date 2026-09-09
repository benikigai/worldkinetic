"""Exercise export cleanup without importing CAD or changing verifier tolerances."""
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/tools'))
from handle_export import strip_zero_area_triangles, MeshTriangleLimitError


def record(vertices):
    return struct.pack('<12fH', 0, 0, 1, *vertices, 0)


class ExportCleanup(unittest.TestCase):
    def test_remove_only_exact_zero_area(self):
        good = record([0, 0, 0, 1, 0, 0, 0, 1, 0])
        zero = record([0, 0, 0, 0, 0, 0, 0, 1, 0])
        tiny = record([0, 0, 0, 1e-6, 0, 0, 0, 1e-6, 0])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mesh.stl'
            path.write_bytes(b'\0' * 80 + struct.pack('<I', 3) + good + zero + tiny)
            self.assertEqual(strip_zero_area_triangles(path), {'triangles': 2, 'zeroAreaTrianglesRemoved': 1})
            self.assertEqual(path.read_bytes()[84:], good + tiny)

    def test_cap_counts_nonzero_triangles_and_reports_exact_count(self):
        good = record([0, 0, 0, 1, 0, 0, 0, 1, 0])
        zero = record([0, 0, 0, 0, 0, 0, 0, 1, 0])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mesh.stl'
            path.write_bytes(b'\0' * 80 + struct.pack('<I', 100001) + good*100000 + zero)
            self.assertEqual(strip_zero_area_triangles(path)['triangles'], 100000)
            path.write_bytes(b'\0' * 80 + struct.pack('<I', 100002) + good*100001 + zero)
            with self.assertRaises(MeshTriangleLimitError) as caught:
                strip_zero_area_triangles(path)
            self.assertEqual(caught.exception.triangles, 100001)

    def test_empty_or_truncated_mesh_cannot_be_exported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mesh.stl'
            for data in (b'', b'\0' * 84, b'\0' * 80 + struct.pack('<I', 1)):
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    strip_zero_area_triangles(path)


if __name__ == '__main__':
    unittest.main()
