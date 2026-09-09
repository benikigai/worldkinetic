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

test('public saved demo is linked without claiming live generation', () => {
  assert.match(body, /\[[^\]]+\]\(https:\/\/worldkinetics\.app\/?\)/);
  assert.match(body, /\[[^\]]+\]\(https:\/\/worldkinetics\.app\/demo\/\)/);
  assert.match(body, /\[[^\]]+\]\(https:\/\/worldkinetics\.app\/workspace\/\?mode=handle-demo\)/);
  assert.match(body, /public saved demo/i);
  assert.match(body, /without generating a new design/i);
  assert.match(body, /public live generation is not yet available/i);
  assert.match(body, /download approved files/i);
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

test('explains workflow value beyond generation with scoped benefits', () => {
  const section = body.match(/^## Why WorldKinetics\?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
  assert.ok(section, 'Why WorldKinetics section required');
  assert.ok(body.indexOf('## Why WorldKinetics?') < body.indexOf('## Current evidence'));
  for (const phrase of ['Keep what fits', 'See what changed', 'Check before you make']) {
    assert.ok(section.includes(phrase), phrase);
  }
  assert.match(section, /(?:measur|requirement)/i);
  assert.match(section, /(?:before.and.after|comparison|compare)/i);
  assert.match(section, /(?:independent|independently)/i);
  assert.match(section, /(?:approv|accept)/i);
  assert.match(section, /exact revision/i);
  assert.match(section, /(?:intended|building toward|planned)/i);
  assert.match(section, /Astra/);
  assert.doesNotMatch(section, /unlike (?:Astra|other)|only (?:we|WorldKinetics)|cannot (?:design|generate) CAD/i);
});
