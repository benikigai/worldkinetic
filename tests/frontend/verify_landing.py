"""OUTSIDE_WRAPPER preregistration. Structure/content checks need separate browser and claim review."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = json.loads((ROOT/'tests/frontend/overview-expected.json').read_text())
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
        for phrase in ['worldkinetics', 'prototype', 'editable', 'reference', 'measurements']: self.assertIn(phrase, overview)
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
        self.assertEqual(len([n for n in workflow.all() if n.tag == 'li']), 4)
        for phrase in ['reference', 'change', 'review', 'download', 'prototyp']: self.assertIn(phrase, workflow.text().lower())

    def test_existing_artwork_theme_controls_and_script_identity_preserved(self):
        original = (ROOT/'tests/frontend/preserved-pre-overview/index.html').read_bytes()
        self.assertEqual(hashlib.sha256(original).hexdigest(), EXPECTED['prior_homepage_sha256'])
        old = original.decode()
        for expression in [r'<svg\b.*?</svg>', r'<section class="directions".*?</section>']:
            self.assertEqual(re.findall(expression, self.content, re.S), re.findall(expression, old, re.S))
        page = self.page; prior = Page(old)
        for tag, attrs in [('script', 'src'), ('link', 'href')]:
            self.assertEqual([n.attrs.get(attrs) for n in page.nodes if n.tag == tag], [n.attrs.get(attrs) for n in prior.nodes if n.tag == tag])
        self.assertEqual(sum(n.tag == 'script' for n in page.nodes), 1)
        self.assertNotRegex(self.content, r'api\.openai\.com|OPENAI_API_KEY|sk-[A-Za-z0-9]{12}')

    def test_demo_links_internal_targets_and_accessible_sections(self):
        page = self.page
        identities = [n.attrs['id'] for n in page.nodes if 'id' in n.attrs]
        self.assertEqual(len(identities), len(set(identities)))
        entries = [n for n in page.nodes if n.tag == 'a' and 'demo-entry' in n.attrs.get('class', '').split()]
        self.assertGreaterEqual(len(entries), 2)
        for node in entries:
            self.assertEqual(node.attrs.get('href'), EXPECTED['demo_url'])
            self.assertIn('demo', node.text().lower()); self.assertNotIn('aria-disabled', node.attrs)
        for node in page.nodes:
            self.assertFalse(any(key.lower().startswith('on') for key in node.attrs), 'No inline event handlers')
            if node.tag == 'section': self.assertIn(node.attrs.get('aria-labelledby'), identities)
            if node.tag == 'a':
                href = node.attrs.get('href', '')
                self.assertTrue(href and not href.startswith('javascript:'))
                if href.startswith('#'): self.assertIn(href[1:], identities)
        self.assertNotIn('/demo/', self.content, 'Reuse the agreed workspace route')

    def test_full_existing_css_prefix_preserved(self):
        content = (ROOT/'src/client/theme.css').read_text()
        self.assertEqual(content.count(EXPECTED['css_marker']), 1)
        original, additions = content.split(EXPECTED['css_marker'])
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(), EXPECTED['theme_prefix_sha256'])
        for selector in ['.overview', '.use-cases', '.example-card', '.how-it-works']: self.assertIn(selector, additions)
        self.assertIn('@media', additions)
        self.assertNotIn('@import', additions); self.assertNotIn('url(', additions)

if __name__ == '__main__': unittest.main()
