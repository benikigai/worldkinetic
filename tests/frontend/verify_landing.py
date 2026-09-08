"""OUTSIDE_WRAPPER preregistration. Structure/content checks need separate browser and claim review."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = json.loads((ROOT/'tests/frontend/overview-expected.json').read_text())
POLISH = json.loads((ROOT/'tests/frontend/home-polish-expected.json').read_text())
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

class Node:
    def __init__(self, tag, attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
    def text(self):
        return ' '.join(' '.join(x.text() if isinstance(x, Node) else x for x in self.children).split())
    def all(self):
        yield self
        for child in self.children:
            if isinstance(child, Node): yield from child.all()

class Page(HTMLParser):
    def __init__(self, content):
        super().__init__()
        self.root = Node('root'); self.stack = [self.root]
        self.feed(content); self.nodes = list(self.root.all())
    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs); self.stack[-1].children.append(node)
        if tag not in VOID: self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))
    def handle_endtag(self, tag):
        for index in range(len(self.stack)-1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]; return
    def handle_data(self, data): self.stack[-1].children.append(data)
    def identified(self, identity):
        return next(node for node in self.nodes if node.attrs.get('id') == identity)

class OverviewAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = (ROOT/'src/client/index.html').read_text(); cls.page = Page(cls.content)

    def test_public_problem_value_and_three_mapped_examples(self):
        page = self.page
        self.assertEqual([n.text() for n in page.nodes if n.tag == 'h1'], ['Prompt to product.'])
        self.assertIn('Customize everyday products without learning CAD.', page.root.text())
        overview = page.identified('overview').text().lower()
        self.assertIn('More than a model. A design you can check.', page.identified('overview').text())
        self.assertIn('Astra proposes the design. WorldKinetics helps you define what matters, check the result, and approve the exact version you want to make.', page.identified('overview').text())
        self.assertIn('worldkinetics', overview)
        for identity, label, status, words in [
            ('repair-example', 'Repair it', 'Concept', ['handle', 'sample', 'mounting']),
            ('fit-example', 'Make it fit', 'Recorded run', ['plate', '30 mm', '2 mm', '36 mm', '5 mm', 'confirmed']),
            ('yours-example', 'Make it yours', 'Concept', ['grip', 'thumb rest', 'accepted', 'mounting']),
        ]:
            node = page.identified(identity); self.assertEqual(node.tag, 'article')
            self.assertIn(label, node.text()); self.assertIn(status, node.text())
            for word in words: self.assertIn(word, node.text().lower())
            details = [n for n in node.all() if n.tag == 'details']
            self.assertEqual(len(details), 1, 'Each case has an accessible on-page example')
            self.assertTrue(any(n.tag == 'summary' and n.text() for n in details[0].all()))
        workflow = page.identified('how-it-works')
        self.assertEqual([n.text() for n in workflow.all() if n.tag == 'h3'], ['Keep what fits', 'See what changed', 'Check before you make'])
        self.assertEqual(len([n for n in workflow.all() if n.tag == 'li']), 3)
        for phrase in ['reference', 'change', 'review', 'download', 'prototyp']: self.assertIn(phrase, workflow.text().lower())
        self.assertEqual(page.identified('workflow-heading').text(), 'Create a design you can review and build.')
        self.assertIn('Describe your idea, check the design, and download editable CAD files for prototyping.', workflow.text())

    def test_existing_artwork_brand_and_script_entry_preserved(self):
        original = (ROOT/'tests/frontend/preserved-pre-overview/index.html').read_bytes()
        self.assertEqual(hashlib.sha256(original).hexdigest(), EXPECTED['prior_homepage_sha256'])
        old = original.decode()
        # The former directions-section freeze is replaced by compact-control acceptance.
        self.assertEqual(re.findall(r'<svg\b.*?</svg>', self.content, re.S), re.findall(r'<svg\b.*?</svg>', old, re.S))
        page = self.page; prior = Page(old)
        for tag, attrs in [('script', 'src'), ('link', 'href')]:
            self.assertEqual([n.attrs.get(attrs) for n in page.nodes if n.tag == tag], [n.attrs.get(attrs) for n in prior.nodes if n.tag == tag])
        self.assertEqual(sum(n.tag == 'script' for n in page.nodes), 1)
        self.assertNotRegex(self.content, r'api\.openai\.com|OPENAI_API_KEY|sk-[A-Za-z0-9]{12}')

    def test_compact_native_theme_controls_replace_design_direction_section(self):
        header = next(node for node in self.page.nodes if node.tag == 'header')
        buttons = [node for node in self.page.nodes if 'data-set-theme' in node.attrs]
        self.assertEqual([node.attrs['data-set-theme'] for node in buttons], list(POLISH['theme_colors']))
        footer = next(node for node in self.page.nodes if node.tag == 'footer')
        footer_nodes = list(footer.all())
        self.assertFalse(any('data-set-theme' in node.attrs for node in header.all()))
        for button in buttons:
            name = button.attrs['data-set-theme']
            self.assertIn(button, footer_nodes)
            self.assertEqual(button.tag, 'button', 'Native buttons retain keyboard activation')
            self.assertEqual(button.attrs.get('type'), 'button')
            self.assertIn(name, button.attrs.get('aria-label', '').lower())
            self.assertIn(name, button.attrs.get('title', '').lower())
            self.assertEqual(button.attrs.get('aria-pressed'), str(name == 'frost').lower())
            self.assertEqual(button.text(), '', 'Theme names belong in accessible labels, not a large description')
            self.assertTrue(any(n.attrs.get('aria-hidden') == 'true' for n in button.all() if n is not button))
        self.assertTrue(any(n.attrs.get('role') == 'group' and n.attrs.get('aria-label') for n in footer_nodes))
        self.assertFalse(any(n.attrs.get('id') == 'directions' for n in self.page.nodes))
        self.assertNotRegex(self.content, r'(?i)explore (?:the )?design direction|FORM STUDY|WK\s*/?\s*001|ABSTRACT MATERIAL|material-chip|material-title|material-detail|theme-description')

    def test_case_evidence_and_statuses_remain_exact(self):
        for identity, expected in POLISH['case_html_sha256'].items():
            card = re.search(r'<article\b[^>]*\bid="' + identity + r'".*?</article>', self.content, re.S)
            self.assertIsNotNone(card)
            self.assertEqual(hashlib.sha256(card.group().encode()).hexdigest(), expected, identity)

    def test_recorded_run_attributes_confirmation_to_actual_api_evidence(self):
        # OUTSIDE_WRAPPER correction: retained evidence was an explicit supervisor API action.
        recorded = self.page.identified('fit-example').text().lower()
        self.assertNotIn('user-confirmed', recorded)
        self.assertNotIn('the user confirmed', recorded)
        self.assertIn('separately confirmed 36 mm requirement', recorded)
        self.assertIn('explicit api confirmation', recorded)

    def test_demo_links_internal_targets_and_accessible_sections(self):
        page = self.page
        identities = [n.attrs['id'] for n in page.nodes if 'id' in n.attrs]
        self.assertEqual(len(identities), len(set(identities)))
        entries = [n for n in page.nodes if n.tag == 'a' and 'demo-entry' in n.attrs.get('class', '').split()]
        self.assertGreaterEqual(len(entries), 2)
        for node in entries:
            # OUTSIDE_WRAPPER: user selected same-origin workspace entry; historical destination remains archived.
            self.assertEqual(node.attrs.get('href'), '/workspace/')
            self.assertIn('demo', node.text().lower()); self.assertNotIn('aria-disabled', node.attrs)
        for node in page.nodes:
            self.assertFalse(any(key.lower().startswith('on') for key in node.attrs), 'No inline event handlers')
            if node.tag == 'section': self.assertIn(node.attrs.get('aria-labelledby'), identities)
            if node.tag == 'a':
                href = node.attrs.get('href', '')
                self.assertTrue(href and not href.startswith('javascript:'))
                if href.startswith('#'): self.assertIn(href[1:], identities)
        self.assertNotIn('/demo/', self.content, 'Reuse the agreed workspace route')

    def test_theme_palette_and_compact_responsive_header(self):
        content = (ROOT/'src/client/theme.css').read_text()
        # Replaces the obsolete whole-prefix freeze while preserving every original theme token.
        blocks = re.findall(r':root(?:\[data-theme="[^"]+"\])?\s*\{[^}]*\}', content)
        self.assertEqual([hashlib.sha256(block.encode()).hexdigest() for block in blocks], POLISH['theme_blocks_sha256'])
        for selector in ['.overview', '.use-cases', '.example-card', '.how-it-works']: self.assertIn(selector, content)
        self.assertIn(':focus-visible', content)
        self.assertIn('prefers-reduced-motion', content)
        control = re.search(r'(?<![\w-])\.theme-option\s*\{([^}]*)\}', content)
        self.assertIsNotNone(control)
        sizes = dict(re.findall(r'(width|height|inline-size|block-size)\s*:\s*(\d+(?:\.\d+)?)px', control.group(1)))
        self.assertTrue('width' in sizes or 'inline-size' in sizes)
        self.assertTrue('height' in sizes or 'block-size' in sizes)
        self.assertTrue(all(24 <= float(value) <= 44 for value in sizes.values()), 'Theme controls must remain compact usable targets')
        for value in re.findall(r'min-(?:width|height)\s*:\s*(\d+(?:\.\d+)?)px', control.group(1)):
            self.assertLessEqual(float(value), 44)
        mobile = []
        for match in re.finditer(r'@media\s*\(max-width:\s*460px\)\s*\{', content):
            depth, cursor = 1, match.end()
            while depth and cursor < len(content):
                depth += (content[cursor] == '{') - (content[cursor] == '}'); cursor += 1
            mobile.append(content[match.end():cursor-1])
        self.assertTrue(any(re.search(r'\.(?:site-header|header-end|demo-entry-compact)\b', block) for block in mobile), 'Compact header needs an explicit narrow-screen rule; browser layout is reviewed separately')
        self.assertNotIn('@import', content); self.assertNotIn('url(', content)

if __name__ == '__main__': unittest.main()
