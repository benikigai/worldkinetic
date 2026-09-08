"""OUTSIDE_WRAPPER supervisor acceptance: approved landing entry and preserved identity."""
from pathlib import Path
import hashlib
from html.parser import HTMLParser
import json
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = json.loads((ROOT/'tests/frontend/landing-expected.json').read_text())

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.entries = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and 'demo-entry' in attrs.get('class', '').split():
            self.entries.append(attrs)

class LandingAcceptance(unittest.TestCase):
    def test_approved_copy_destination_and_preserved_markup(self):
        content = (ROOT/'src/client/index.html').read_bytes()
        self.assertEqual(hashlib.sha256(content).hexdigest(), EXPECTED['homepage_sha256'], 'Only the approved copy and two demo entries may change; preserve all artwork, favicon, themes and scripts')
        parsed = Links(); parsed.feed(content.decode())
        self.assertEqual(len(parsed.entries), 2)
        for entry in parsed.entries:
            self.assertEqual(entry['href'], EXPECTED['demo_url'])
            self.assertNotIn('onclick', entry)
            self.assertNotIn('aria-disabled', entry)

    def test_theme_rules_preserved_and_demo_styles_present(self):
        content = (ROOT/'src/client/theme.css').read_text()
        self.assertEqual(content.count(EXPECTED['css_marker']), 1)
        original, new = content.split(EXPECTED['css_marker'])
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(), EXPECTED['theme_prefix_sha256'], 'Preserve every existing theme, responsive and reduced-motion rule')
        self.assertIn('.demo-entry', new)
        self.assertIn('.hero-actions', new)
        self.assertNotIn('@import', new)
        self.assertNotIn('url(', new)

if __name__ == '__main__':
    unittest.main()
