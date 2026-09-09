"""OUTSIDE_WRAPPER: public workspace structure; actual browser layout is verified separately."""
from pathlib import Path
import json
import unittest
from verify_guide import Document, Node

ROOT = Path(__file__).resolve().parents[2]


class ConsumerPageAcceptance(unittest.TestCase):
    def setUp(self):
        self.page = Document((ROOT/'src/client/workspace/index.html').read_text()).root
        self.nodes = list(self.page.walk())
        self.ids = {n.attrs['id']: n for n in self.nodes if 'id' in n.attrs}
        self.parents = {}
        for n in self.nodes:
            for child in n.children:
                if isinstance(child, Node): self.parents[id(child)] = n

    def node(self, identity):
        self.assertTrue(identity in self.ids, f'Missing public interaction: {identity}')
        return self.ids[identity]

    def collapsed_ancestor(self, node):
        while id(node) in self.parents:
            node = self.parents[id(node)]
            if node.tag == 'details' and 'open' not in node.attrs: return True
        return False

    def test_public_entry_and_compact_progress_have_no_setup_jargon(self):
        progress = self.node('consumer-progress')
        self.assertEqual(progress.tag, 'ol')
        items = [n for n in progress.children if isinstance(n, Node)]
        self.assertEqual([' '.join(n.text().split()).lower() for n in items], ['describe', 'confirm sizes', 'review', 'make your part'])
        text = self.page.text().lower()
        self.assertIn('what would you like to change?', text)
        self.assertIn('handle', self.node('consumer-title').text().lower())
        for identity, label in [('live-sample', 'sample prompt'), ('live-review-sizes', 'submit idea'), ('live-change', 'make another change')]:
            node = self.node(identity)
            self.assertEqual(node.tag, 'button')
            self.assertEqual(node.attrs.get('type'), 'button')
            self.assertIn(label, node.text().lower())
        self.assertIn('approve design', self.node('live-accept').text().lower())
        self.assertIn('before', self.node('live-comparison').text().lower())
        self.assertIn('your design', self.node('live-comparison').text().lower())

    def test_debug_modes_and_long_guide_are_native_collapsed_disclosures(self):
        for identity in ['live-selection','live-cursor','live-activity','live-evidence','wireframe','scenario','review-scenario']:
            self.assertTrue(self.collapsed_ancestor(self.node(identity)), f'{identity} must not dominate the initial consumer page')
        self.assertTrue(self.collapsed_ancestor(self.node('workspace-guide')))
        self.assertTrue(self.collapsed_ancestor(self.node('live-checks')))
        self.assertEqual(self.node('live-size-review').tag, 'details')
        self.assertTrue(any(n.attrs.get('id') == 'live-request' for n in self.node('live-inputs').walk()))
        for label in ['technical details', 'test data', 'earlier designs']:
            self.assertTrue(any(n.tag == 'summary' and label in n.text().lower() for n in self.nodes), label)
        for identity in ['live-request', 'live-status', 'viewport']:
            self.assertFalse(self.collapsed_ancestor(self.node(identity)), f'{identity} is core to the live flow')

    def test_making_guidance_is_gated_and_supplier_links_are_manual(self):
        files = self.node('live-files')
        self.assertIn('hidden', files.attrs)
        text = files.text().lower()
        for label in ['print it myself', 'get a prototype', 'make multiple', 'no automatic upload or order', 'hardware and threads are not designed']:
            self.assertIn(label, text)
        links = [n for n in files.walk() if n.tag == 'a']
        self.assertEqual(len(links), 3)
        self.assertFalse(self.collapsed_ancestor(self.node('making-suppliers')))
        self.assertIn('choose a supplier', self.node('making-overview').text().lower())
        self.assertEqual(text.count('quote required'), 6)
        for link in links:
            self.assertEqual(link.attrs.get('target'), '_blank')
            self.assertIn('noreferrer', link.attrs.get('rel', ''))
        self.assertFalse(any(n.tag == 'form' for n in files.walk()))
        self.assertIn('disabled', self.node('make-package').attrs)
        self.assertFalse(self.collapsed_ancestor(self.node('make-package')))
        self.assertTrue(self.collapsed_ancestor(self.node('live-artifact')))
        self.assertTrue(self.collapsed_ancestor(self.node('live-download')))
        for identity in ['make-quantity', 'make-material', 'make-finish', 'make-destination', 'make-needed-by']:
            self.assertNotIn('required', self.node(identity).attrs)
            self.assertTrue(self.collapsed_ancestor(self.node(identity)))

    def test_recorded_handle_is_discoverable_outside_the_session_gate(self):
        for identity, href in [('recorded-entry', '/workspace/?mode=handle-demo'), ('create-entry', '/workspace/?mode=live')]:
            node = self.node(identity)
            self.assertEqual(node.attrs.get('href'), href)
            self.assertFalse(self.collapsed_ancestor(node))
            ancestors = []
            while id(node) in self.parents:
                node = self.parents[id(node)]
                ancestors.append(node.attrs.get('id'))
            self.assertNotIn('workspace-content', ancestors)
            self.assertNotIn('session-gate', ancestors)
        self.assertIn('Recorded example', self.node('recorded-panel').text())
        self.assertIn('Nothing is being generated now', self.node('recorded-panel').text())
        self.assertEqual(self.node('recorded-comparison').tag, 'select')

    def test_every_existing_control_identity_and_safe_entry_are_retained(self):
        expected = json.loads((ROOT/'tests/frontend/consumer-expected.json').read_text())
        for identity in expected['existing_control_ids']:
            self.assertTrue(identity in self.ids, f'Preserve existing control: {identity}')
        ids = [n.attrs['id'] for n in self.nodes if 'id' in n.attrs]
        self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual([n.attrs.get('src') for n in self.nodes if n.tag == 'script'], ['/workspace/main.js'])
        for n in self.nodes:
            self.assertFalse(any(k.startswith('on') for k in n.attrs))
            self.assertNotEqual(n.tag, 'iframe')
            self.assertFalse(n.tag == 'input' and n.attrs.get('type') == 'file')
            if n.tag == 'a':
                href = n.attrs.get('href','')
                self.assertTrue(not href.startswith('/demo/') or href == '/demo/')
                if href.startswith('#'): self.assertTrue(href[1:] in self.ids)


if __name__ == '__main__': unittest.main()
