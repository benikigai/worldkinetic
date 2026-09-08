"""OUTSIDE_WRAPPER: preregistered guide acceptance, not browser or CAD evidence."""
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / 'src/client/workspace/index.html'
STYLE = ROOT / 'src/client/workspace/workspace.css'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()

    def text(self):
        return ' '.join(child.text() if isinstance(child, Node) else child for child in self.children)

    def canonical(self, omit=None):
        children = []
        for child in self.children:
            if isinstance(child, Node):
                if omit is None or child.attrs.get('id') != omit:
                    children.append(child.canonical(omit))
            elif child.strip():
                children.append(' '.join(child.split()))
        return [self.tag, sorted(self.attrs.items()), children]


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node('document')
        self.stack = [self.root]
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if len(self.stack) > 1 and self.stack[-1].tag == tag:
            self.stack.pop()
        else:
            raise AssertionError(f'Unbalanced closing tag: {tag}')

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


class GuideAcceptance(unittest.TestCase):
    def setUp(self):
        self.source = PAGE.read_text()
        self.document = Document(self.source).root
        self.nodes = list(self.document.walk())
        self.ids = {node.attrs['id']: node for node in self.nodes if 'id' in node.attrs}

    def guide(self):
        self.assertTrue('workspace-guide' in self.ids, 'Add the explanatory guide without replacing the workspace')
        return self.ids['workspace-guide']

    def example(self, identity, label, title, status):
        self.guide()
        self.assertIn(identity, self.ids)
        node = self.ids[identity]
        self.assertEqual(node.tag, 'details', 'Examples must be native collapsible sections')
        self.assertNotIn('open', node.attrs, 'Keep the long explanation collapsed initially')
        children = [child for child in node.children if isinstance(child, Node)]
        self.assertEqual(children[0].tag, 'summary')
        summary = ' '.join(children[0].text().split()).lower()
        for value in (label, title, status):
            self.assertIn(value.lower(), summary)
        return node

    def test_existing_workspace_and_controller_sources_are_preserved(self):
        expected = json.loads((ROOT / 'tests/frontend/guide-expected.json').read_text())
        self.assertEqual(digest(self.document.canonical('workspace-guide')), expected['workspace_tree_sha256'])
        css = STYLE.read_bytes()
        self.assertEqual(hashlib.sha256(css[:expected['css_bytes']]).hexdigest(), expected['css_sha256'], 'Append CSS; preserve the accepted viewer styles')
        for name, sha in expected['immutable_files'].items():
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), sha, name)

    def test_guide_is_passive_accessible_and_has_real_local_navigation(self):
        guide = self.guide()
        self.assertEqual(guide.tag, 'section')
        self.assertIn(guide.attrs.get('aria-labelledby'), self.ids)
        ids = [node.attrs['id'] for node in self.nodes if 'id' in node.attrs]
        self.assertEqual(len(ids), len(set(ids)), 'DOM identities must stay unique')
        links = [node for node in guide.walk() if node.tag == 'a']
        self.assertTrue(any('inspect the workspace' in node.text().lower() and node.attrs.get('href') == '#viewport' for node in links))
        for node in guide.walk():
            self.assertNotIn(node.tag, {'script', 'button', 'form', 'input', 'select', 'textarea', 'iframe', 'video', 'audio', 'progress'})
            self.assertFalse(any(key.startswith('on') for key in node.attrs), 'Guide cannot trigger actions')
            self.assertNotIn(node.attrs.get('role'), {'button', 'tab', 'progressbar'})
            self.assertNotIn('hidden', node.attrs)
            if node.tag == 'a':
                href = node.attrs.get('href', '')
                self.assertTrue(href.startswith('#') and href[1:] in self.ids, href)
            if node.tag == 'svg':
                self.assertEqual(node.attrs.get('role'), 'img')
                self.assertIn('viewbox', node.attrs)
                labels = node.attrs.get('aria-labelledby', '').split()
                self.assertGreaterEqual(len(labels), 2)
                self.assertTrue(all(label in self.ids and self.ids[label].text().strip() for label in labels))
                self.assertTrue(any(child.tag == 'title' for child in node.walk()))
                self.assertTrue(any(child.tag == 'desc' for child in node.walk()))

    def test_six_ordered_steps_explain_real_actions_and_revision_bound_review(self):
        guide = self.guide()
        self.assertIn('guide-steps', self.ids)
        steps = self.ids['guide-steps']
        self.assertEqual(steps.tag, 'ol')
        items = [child for child in steps.children if isinstance(child, Node)]
        self.assertEqual([child.tag for child in items], ['li'] * 6)
        phrases = [('reference',), ('confirm', 'request'), ('actual', 'event'), ('revised', 'check'), ('explicit', 'accept'), ('exact', 'accepted', 'download')]
        for item, required in zip(items, phrases):
            text = item.text().lower()
            for word in required:
                self.assertIn(word, text)
        text = ' '.join(guide.text().split()).lower()
        self.assertIn('saved reference', text)
        self.assertIn('synthetic', text)
        self.assertIn('live numeric', text)
        self.assertRegex(text, r'completion.{0,90}(not|never).{0,60}accept|not.{0,50}automatically accept')

    def test_repair_example_is_a_sample_mounting_brief_with_axes_only(self):
        node = self.example('guide-repair', 'Repair it', 'Replacement handle concept', 'Concept')
        text = ' '.join(node.text().split()).lower()
        for phrase in ['in development', 'sample', '96 mm', '25 mm', '140 mm', 'empty finger gap', 'hardware', 'unspecified']:
            self.assertIn(phrase, text)
        self.assertIn('guide-mount-datums', self.ids)
        geometry = self.ids['guide-mount-datums']
        axes = [n for n in geometry.walk() if n.attrs.get('data-datum')]
        self.assertEqual(len(axes), 2)
        self.assertEqual({n.tag for n in axes}, {'line'})
        coords = sorted((float(n.attrs['x1']), float(n.attrs['x2'])) for n in axes)
        self.assertEqual(coords, [(0, 0), (96, 96)])
        for axis in axes:
            self.assertLess(float(axis.attrs['y1']), float(axis.attrs['y2']))
        self.assertFalse(any(n.tag in {'path', 'rect', 'circle', 'ellipse', 'polygon', 'image'} for n in geometry.walk()), 'Show datums, not invented handle geometry or hardware')
        self.assertRegex(text, r'(not|no).{0,70}(damaged original|measured cabinet)')

    def test_recorded_plate_story_preserves_actual_measurements_and_confirmation_actor(self):
        node = self.example('guide-fit', 'Make it fit', 'Resize a mounting plate', 'Recorded run')
        text = ' '.join(node.text().split()).lower()
        for phrase in ['30 mm', '2 mm', '5 mm', '36 mm', '35 mm', '6 mm', '20 mm', '7', 'rejected', 'illustration', 'explicit api confirmation', 'separately confirmed']:
            self.assertIn(phrase, text)
        self.assertRegex(text, r'7.{0,25}checks.{0,25}passed|7.{0,25}passed.{0,25}checks')
        self.assertNotRegex(text, r'user.confirmed|the user confirmed|human.confirmed')
        self.assertRegex(text, r'(retained|recorded).{0,80}(api|cad)')
        self.assertRegex(text, r'(not|no).{0,100}(loaded cad|live cad|live run|public live|video)')
        self.assertRegex(text, r'(not|no).{0,100}physical fit|physical fit.{0,50}(not|unverified)')

    def test_plate_diagrams_use_exact_frozen_millimeter_geometry(self):
        self.guide()
        self.assertIn('guide-plate-top', self.ids)
        self.assertIn('guide-plate-side', self.ids)
        top = self.ids['guide-plate-top']
        rects = [n for n in top.walk() if n.tag == 'rect']
        holes = [n for n in top.walk() if n.tag == 'circle']
        self.assertEqual(len(rects), 1)
        self.assertEqual({key: float(rects[0].attrs.get(key, 0)) for key in ['x', 'y', 'width', 'height', 'rx', 'ry']}, {'x': 0, 'y': 0, 'width': 36, 'height': 35, 'rx': 0, 'ry': 0})
        self.assertEqual(sorted((float(n.attrs['cx']), float(n.attrs['cy']), float(n.attrs['r'])) for n in holes), [(8, 17.5, 3), (28, 17.5, 3)])
        sides = [n for n in self.ids['guide-plate-side'].walk() if n.tag == 'rect']
        self.assertEqual(len(sides), 1)
        self.assertEqual((float(sides[0].attrs['width']), float(sides[0].attrs['height'])), (36, 5))
        # L/2 - pitch/2 - radius is the frozen end-material rule, not a drawing estimate.
        self.assertEqual(36 / 2 - 20 / 2 - 6 / 2, 5)
        self.assertEqual(30 / 2 - 20 / 2 - 6 / 2, 2)

    def test_personalization_is_intended_refinement_of_an_explicitly_accepted_handle(self):
        node = self.example('guide-yours', 'Make it yours', 'Broader grip with thumb rest', 'Concept')
        text = ' '.join(node.text().split()).lower()
        for phrase in ['in development', 'intended', 'initial handle', 'generated', 'checked', 'explicit', 'accepted', 'mount', 'finger gap', 'nine checks', 'download']:
            self.assertIn(phrase, text)
        self.assertRegex(text, r'not.{0,50}(live|available)|runtime.{0,50}(pending|unverified)|await.{0,50}(runtime|verification)')
        self.assertFalse(any(n.tag in {'path', 'circle', 'ellipse', 'image', 'polygon'} for n in node.walk()), 'Concept flow can show semantic stages, not invented handle geometry')

    def test_new_style_is_scoped_responsive_and_keeps_diagrams_fluid(self):
        self.guide()
        expected = json.loads((ROOT / 'tests/frontend/guide-expected.json').read_text())
        appended = STYLE.read_bytes()[expected['css_bytes']:].decode()
        self.assertRegex(appended, r'@media\s*\([^)]*max-width')
        self.assertRegex(appended, r'\.wk-guide[^{}]*svg\s*\{[^}]*width:\s*100%')
        self.assertRegex(appended, r'\.wk-guide[^{}]*svg\s*\{[^}]*height:\s*auto')
        self.assertNotRegex(appended, r'@import|url\(')
        self.assertNotRegex(appended, r'position:\s*(fixed|absolute)')
        self.assertNotRegex(appended, r'(?<!max-)width:\s*\d{3,}px')
        # Nested media blocks are allowed; every new selector targets only the added guide.
        for selector in re.findall(r'(?:^|[{}])\s*([^{}]+)\{', re.sub(r'/\*.*?\*/', '', appended, flags=re.S)):
            if not selector.strip().startswith('@'):
                self.assertTrue(all('.wk-guide' in part for part in selector.split(',')), selector)


if __name__ == '__main__':
    unittest.main()
