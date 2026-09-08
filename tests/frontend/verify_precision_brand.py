"""Protected acceptance for the user-selected 2D identity.

OUTSIDE_WRAPPER: supervisor acceptance setup. These checks establish geometry
fidelity, preservation and export consistency. Browser appearance remains a
separate manual observation; no document or image-existence pass proves it.
"""

from collections import Counter
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
CLIENT = ROOT / 'src/client'
BRAND = CLIENT / 'brand'
CHECKS = Path(__file__).resolve().parent
CONTRACT = json.loads((CHECKS / 'precision-contract.json').read_text())
SVG_NS = 'http://www.w3.org/2000/svg'


def digest(data):
    return sha256(data).hexdigest()


def extract(text, pattern):
    match = re.search(pattern, text, re.S)
    assert match, pattern
    return match.group(0)


def svg(text):
    return ET.fromstring(text)


def local(tag):
    return tag.rsplit('}', 1)[-1]


def shapes(root):
    """Compare selected primitives and inherited paint, independent of IDs/framing."""
    records = []
    geometry = ('d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry')
    paint = ('fill', 'stroke', 'stroke-width', 'opacity', 'stroke-linejoin')

    def walk(element, inherited):
        styles = {**inherited, **{k: v for k, v in element.attrib.items() if k in paint}}
        tag = local(element.tag)
        if tag in ('path', 'circle', 'ellipse', 'rect'):
            properties = {k: element.get(k) for k in geometry if element.get(k) is not None}
            properties.update(styles)
            properties = {k: re.sub(r'\s+', ' ', v.strip()).replace('var(--accent)', 'var(--accent, #365eed)') for k, v in properties.items()}
            records.append((tag, tuple(sorted(properties.items()))))
        for child in element:
            walk(child, styles)

    walk(root, {})
    return Counter(records)


def reference(suffix=''):
    return ET.parse(CHECKS / f'precision-reference/approved{suffix}.svg').getroot()


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        for key in ('src', 'href'):
            target = values.get(key, '')
            if target and not target.startswith(('#', 'http:', 'https:', 'mailto:', 'data:')):
                self.targets.append(target)


class PrecisionIdentity(unittest.TestCase):
    def test_canonical_marks_match_approved_geometry_and_paint(self):
        for name, suffix in [('mark-color.svg', ''), ('mark-mono.svg', '-mono'), ('mark-inverse.svg', '-inverse')]:
            with self.subTest(name=name):
                actual = ET.parse(BRAND / name).getroot()
                self.assertEqual(shapes(actual), shapes(reference(suffix)))
                self.assertIn(actual.get('viewBox'), ['0 0 200 200', '20 27 140 140'])
                self.assertIn('Precision', ''.join(actual.itertext()))
                if suffix == '-inverse':
                    self.assertIn(actual.get('color'), ['#f4f6f6', '#F4F6F6', '#fff', '#ffffff'])

    def test_header_uses_precision_with_accessible_theme_inheritance(self):
        header = extract((CLIENT / 'index.html').read_text(), r'<header class="site-header">.*?</header>')
        mark = svg(extract(header, r'<svg\b.*?</svg>'))
        self.assertEqual(shapes(mark), shapes(reference()))
        self.assertEqual(mark.get('viewBox'), '20 27 140 140')
        self.assertEqual(mark.get('aria-hidden'), 'true')
        self.assertEqual(mark.get('focusable'), 'false')
        self.assertIn(mark.get('color'), [None, 'inherit', 'currentColor'])
        self.assertIn('var(--accent)', ET.tostring(mark, encoding='unicode'))
        self.assertIn('aria-label="WorldKinetics home"', header)
        self.assertIn('href="./"', header)
        ids = [node.get('id') for node in mark.iter() if node.get('id')]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(ids, 'The mark must retain its globe/letter clearance mask')
        self.assertNotIn('space', ids, 'Use a header-specific mask ID')
        for node in mark.iter():
            for value in node.attrib.values():
                for identifier in re.findall(r'url\(#([^)]*)\)', value):
                    self.assertIn(identifier, ids)

    def test_homepage_layout_artwork_and_wordmark_are_preserved(self):
        home = (CLIENT / 'index.html').read_text()
        outside = re.sub(r'<header class="site-header">.*?</header>', '<HEADER/>', home, flags=re.S)
        self.assertEqual(digest(outside.encode()), CONTRACT['homepage_outside_header_sha256'])
        lettering = extract(home, r'<svg class="wordmark-type".*?</svg>')
        self.assertEqual(digest(lettering.encode()), CONTRACT['wordmark_svg_sha256'])
        for name, expected in CONTRACT['readonly_sha256'].items():
            with self.subTest(name=name):
                self.assertEqual(digest((ROOT / name).read_bytes()), expected)

    def test_horizontal_export_contains_the_current_mark_and_outlined_wordmark(self):
        horizontal = ET.parse(BRAND / 'worldkinetics-horizontal.svg').getroot()
        expected = shapes(reference())
        self.assertFalse(expected - shapes(horizontal), 'Horizontal export contains stale or incomplete logo geometry')
        wordmark = ET.parse(BRAND / 'worldkinetics-wordmark.svg').getroot()
        expected_paths = [n.get('d') for n in wordmark.iter() if local(n.tag) == 'path']
        actual_paths = [n.get('d') for n in horizontal.iter() if local(n.tag) == 'path']
        self.assertTrue(all(p in actual_paths for p in expected_paths))
        self.assertFalse(any(local(n.tag) in ('text', 'image', 'script', 'foreignObject') for n in horizontal.iter()))

    def test_brand_page_identifies_the_selected_design_and_preserves_motion(self):
        brand = (BRAND / 'index.html').read_text()
        self.assertRegex(brand, r'2D\s*(?:/\s*)?Precision')
        self.assertNotIn('Refined A', brand)
        self.assertNotIn('Clear at every scale.', brand)
        self.assertRegex(brand, r'(?i)original Adaptive K')
        self.assertIn('No CAD execution', brand)
        scene = extract(brand, r'<svg class="scene".*?</svg>')
        controls = extract(brand, r'<section class="motion-controls".*?</section>')
        self.assertEqual(digest(scene.encode()), CONTRACT['motion_scene_sha256'])
        self.assertEqual(digest(controls.encode()), CONTRACT['motion_controls_sha256'])
        self.assertRegex(brand, r'alt="[^"]*[Pp]recision[^"]*"')

    def test_download_archive_matches_current_individual_assets(self):
        expected = {'mark-color.svg', 'mark-small.svg', 'mark-mono.svg', 'mark-inverse.svg', 'worldkinetics-wordmark.svg', 'worldkinetics-horizontal.svg', 'README.md'}
        with ZipFile(BRAND / 'worldkinetics-logo-kit.zip') as archive:
            self.assertIsNone(archive.testzip())
            members = {Path(name).name: name for name in archive.namelist()}
            self.assertEqual(set(members), expected)
            self.assertEqual(len(archive.namelist()), len(expected))
            for name in expected:
                self.assertEqual(archive.read(members[name]), (BRAND / name).read_bytes(), name)
        guidance = (BRAND / 'README.md').read_text()
        self.assertRegex(guidance, r'2D\s*(?:/\s*)?Precision')
        self.assertIn('16', guidance)
        self.assertRegex(guidance, r'(?i)simpl(?:e|ified).*K')

    def test_every_visible_local_asset_and_download_resolves(self):
        for page in [CLIENT / 'index.html', BRAND / 'index.html']:
            parser = Links()
            parser.feed(page.read_text())
            for target in parser.targets:
                resolved = page.parent / target.split('?', 1)[0].split('#', 1)[0]
                self.assertTrue(resolved.exists(), str(resolved))

    def test_changes_stay_inside_frontend_ownership(self):
        for name, expected in CONTRACT['nonfrontend_sha256'].items():
            self.assertEqual(digest((ROOT / name).read_bytes()), expected, name)
        known = set(CONTRACT['nonfrontend_sha256'])
        files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
        unexpected = [p for p in files if p and p not in known and not p.startswith(('src/client/', 'tests/frontend/')) and p != '.astra_dev_log.jsonl']
        self.assertEqual(unexpected, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
