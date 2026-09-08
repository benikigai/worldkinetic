"""OUTSIDE_WRAPPER: preregistered favicon identity and publication acceptance."""
from pathlib import Path
import hashlib
import json
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'src/client/brand'
NAME = 'favicon-2d-precision-v1.svg'
SVG = '{http://www.w3.org/2000/svg}'

class FaviconAcceptance(unittest.TestCase):
    def test_exact_approved_mark_with_frost_tile(self):
        icon = ET.parse(BRAND / NAME).getroot()
        approved = ET.parse(BRAND / 'mark-color.svg').getroot()
        self.assertEqual(icon.attrib, approved.attrib)
        rects = [n for n in icon if n.tag == SVG + 'rect']
        self.assertEqual(len(rects), 1)
        tile = rects[0]
        self.assertEqual(tile.attrib, {'x':'20','y':'27','width':'140','height':'140','rx':'26.25','fill':'#f3f5f5'})
        self.assertLess(list(icon).index(tile), next(i for i,n in enumerate(icon) if n.tag == SVG+'g'))
        icon.remove(tile)
        def tree(n):
            return (n.tag, sorted(n.attrib.items()), (n.text or '').strip(), [tree(c) for c in n])
        self.assertEqual(tree(icon), tree(approved), 'Preserve the approved geometry, masks, paint and title exactly')

    def test_only_authorized_page_and_handoff_copy_changes(self):
        expected = json.loads((ROOT/'tests/frontend/favicon-expected.json').read_text())
        for name, digest in expected.items():
            if name == 'src/client/workspace/index.html':
                # OUTSIDE_WRAPPER: the authorized live workspace replaces only this whole-page guard.
                original = ROOT/'tests/frontend/preserved-pre-live/workspace-index.html'
                self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), digest, 'Preserved accepted workspace')
                page = (ROOT/name).read_text()
                self.assertEqual(page.count('rel=\"icon\"'), 1)
                self.assertIn('<link rel=\"icon\" href=\"/brand/favicon-2d-precision-v1.svg\" type=\"image/svg+xml\">', page)
            else:
                self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(), digest, name)

    def test_kit_contains_identical_favicon_and_assets(self):
        names = {NAME,'mark-color.svg','mark-small.svg','mark-mono.svg','mark-inverse.svg','worldkinetics-wordmark.svg','worldkinetics-horizontal.svg','README.md'}
        with zipfile.ZipFile(BRAND/'worldkinetics-logo-kit.zip') as kit:
            self.assertEqual(len(kit.namelist()), len(names))
            self.assertEqual(set(kit.namelist()), names)
            for name in names:
                self.assertEqual(kit.read(name), (BRAND/name).read_bytes(), name)

    def test_current_and_legacy_usage_is_truthful(self):
        readme = (BRAND/'README.md').read_text()
        self.assertIn(NAME, readme)
        self.assertRegex(readme, r'(?i)legacy.*Adaptive K|Adaptive K.*legacy')
        self.assertRegex(readme, r'(?i)favicon.*Frost|Frost.*favicon')
        self.assertNotIn('All assets have transparent backgrounds', readme)
        self.assertNotIn('use the simple K at 16 px', readme)
        self.assertNotIn('simple K for the 16 px favicon', readme)

if __name__ == '__main__':
    unittest.main()
