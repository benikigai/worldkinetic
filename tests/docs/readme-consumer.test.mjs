import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const body = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const intro = body.split(/^## /m)[0];

test('consumer promise leads before implementation detail', () => {
  for (const phrase of ['Prompt to product.', 'without learning CAD', 'Repair it. Make it fit. Make it yours.']) {
    assert.ok(intro.includes(phrase), phrase);
  }
  assert.ok(body.indexOf('cabinet handle') < body.indexOf('## Run'));
});

test('three everyday examples are illustrative, not claimed completed workflows', () => {
  for (const phrase of ['cabinet handle', 'vacuum', 'tactile', 'illustrative', 'attachment']) {
    assert.ok(body.toLowerCase().includes(phrase), phrase);
  }
  assert.match(body, /(?:measured|confirmed) (?:dimensions|measurements)/i);
  assert.match(body, /(?:not all|not yet|planned).*?(?:implemented|workflows|available)/i);
});

test('website is linked but nonexistent public demo is not offered', () => {
  assert.match(body, /\[[^\]]+\]\(https:\/\/worldkinetics\.app\/?\)/);
  assert.match(body, /(?:public|interactive) demo[^\n]*(?:not yet live|coming soon|not yet available)/i);
  assert.doesNotMatch(body, /\]\(https?:\/\/demo\.worldkinetics\.app[^)]*\)/);
  assert.doesNotMatch(body, /\[(?:try|launch|open|live)[^\]]*demo[^\]]*\]\(http:\/\/(?:localhost|127\.0\.0\.1)/i);
});

test('current scoped evidence and historical snapshot stay distinct', () => {
  assert.ok(body.includes('0311706'));
  assert.ok(body.includes('4090c8166a2e52eb3e16e094d42c7bd1423407a8'));
  assert.match(body, /numeric (?:planning|parameters)/i);
  assert.match(body, /not (?:yet )?model-authored Python/i);
  assert.match(body, /(?:local API|API-level)/i);
  assert.match(body, /(?:30\s*mm|30 mm)/i);
  assert.match(body, /(?:36\s*mm|36 mm)/i);
});

test('design and approval limits remain explicit', () => {
  assert.match(body, /(?:approve|accept)[^\n]*exact revision/i);
  assert.match(body, /(?:manufacturer review|manufacturing review)/i);
  assert.match(body, /(?:photo|image|picture)[^\n]*(?:cannot|not)[^\n]*(?:dimensions|measurement)/i);
  assert.match(body, /(?:not|no)[^\n]*(?:physical fit|physically tested)/i);
  assert.doesNotMatch(body, /guaranteed|world.s first|manufacturing-ready/i);
});

test('developer instructions and linked evidence remain available', () => {
  for (const phrase of ['npm ci', 'npm run build', 'npm start', 'npm test', 'docs/provenance.md', 'docs/architecture.md', 'examples/plate/README.md']) {
    assert.ok(body.includes(phrase), phrase);
  }
});
