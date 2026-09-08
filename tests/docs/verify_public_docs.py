"""Check public documentation links, commands and boundaries, not runtime claims."""
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
FILES = ['README.md', 'docs/architecture.md', 'docs/build-plan.md', 'docs/provenance.md']
scripts = json.loads((ROOT / 'package.json').read_text())['scripts']

def require(condition, message):
    if not condition:
        raise ValueError(message)

def anchors(path):
    found, counts = set(), {}
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', path.read_text(), re.M):
        heading = re.sub(r'<[^>]*>', '', heading).lower()
        slug = re.sub(r'[^\w\- ]', '', heading).replace(' ', '-')
        n = counts.get(slug, 0)
        counts[slug] = n + 1
        found.add(slug + ('-' + str(n) if n else ''))
    return found

diagrams = []
links = 0
for name in FILES:
    path = ROOT / name
    body = path.read_text()
    require('\u2014' not in body, name + ': no em dashes')
    require(not re.search(r'/Users/|/private/tmp/|fleet-private/|agent-coordination/|architecture-review-|op://|\.git/astra/', body), name + ': private/local reference')
    require(not re.search(r'\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})', body), name + ': possible credential')
    blocks = re.findall(r'^```([^\n]*)\n(.*?)^```[ \t]*$', body, re.M | re.S)
    require(len(re.findall(r'^```', body, re.M)) == 2 * len(blocks), name + ': unbalanced code fences')
    for language, code in blocks:
        if language.strip() == 'mermaid':
            first = code.strip().splitlines()[0]
            require(first.startswith(('flowchart ', 'sequenceDiagram', 'stateDiagram-v2')), name + ': unsupported diagram kind')
            require('%%{init' not in code and '<script' not in code.lower(), name + ': active Mermaid directives')
            diagrams.append((name, first))
    for command in re.findall(r'\bnpm run ([\w:-]+)', body):
        require(command in scripts, name + ': nonexistent npm script ' + command)
    for target in re.findall(r'\[[^\]]+\]\(([^\s)]+)\)', body):
        target = target.strip('<>')
        uri = urlsplit(target)
        if uri.scheme:
            require(uri.scheme in ('https', 'http'), name + ': unsupported link scheme')
            continue
        require(not uri.netloc, name + ': protocol-relative link')
        linked = (path.parent / unquote(uri.path)).resolve() if uri.path else path
        require(linked == ROOT or ROOT in linked.parents, name + ': link leaves repository')
        require(linked.exists(), name + ': broken local link ' + target)
        if uri.fragment and linked.suffix == '.md':
            require(unquote(uri.fragment) in anchors(linked), name + ': unknown anchor ' + target)
        links += 1

require(len((ROOT / 'README.md').read_text().split()) <= 850, 'README should stay concise')
require(len(diagrams) == 4, 'Expected one README and three architecture diagrams')
require(sum(name == 'README.md' for name, _ in diagrams) == 1, 'README overview diagram missing')
require(any(kind == 'sequenceDiagram' for _, kind in diagrams), 'Request/acceptance sequence missing')
require(any(kind == 'stateDiagram-v2' for _, kind in diagrams), 'Candidate-state diagram missing')
require('roles-and-exclusive-paths' in anchors(ROOT / 'docs/build-plan.md'), 'Preserve contributor ownership anchor')
architecture = (ROOT / 'docs/architecture.md').read_text()
for token in ['build123d', '0.11.1', 'wk-prototype-0.2', 'geometry.valid_single_solid', 'holes.layout', 'export.editable_reopen', 'interface.protected_region', 'feature.requested_change', 'acceptedRevisionId']:
    require(token in architecture, 'Architecture contract missing ' + token)
require('gpt-image-2.5-flare' in architecture and 'optional' in architecture.lower(), 'Optional Images 2.5 scope missing')
print(json.dumps({'status':'PASS','files':len(FILES),'localLinksChecked':links,'mermaidBlocks':len(diagrams),'scope':'Links, anchors, script names, document structure and public boundaries only; claims and rendered diagrams require review.'}))
