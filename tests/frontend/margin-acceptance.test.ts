// OUTSIDE_WRAPPER: preregistered measurement display acceptance; all snapshots are synthetic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mountLive } from '../../src/client/workspace/live.js';
import type { LiveWorkspaceController } from '../../src/client/workspace/live-state.js';

const presentationPath = '../../src/client/workspace/live-presentation.js';
const fixture = JSON.parse(await readFile(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url), 'utf8'));

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  value = '';
  disabled = false;
  open = false;
  constructor(readonly tag: string) {}
  append(...nodes: Element[]) { this.children.push(...nodes); }
  prepend(...nodes: Element[]) { this.children.unshift(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = [...nodes]; }
  querySelectorAll() { return []; }
  addEventListener() {}
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function renderedMargin(measured: unknown, state = 'failed', historical = false) {
  const bootstrap = structuredClone(fixture);
  const check = bootstrap.candidates[0].checks.find((item: { checkId: string }) => item.checkId === 'margin.end_material');
  if (measured === undefined) bootstrap.candidates[0].checks = bootstrap.candidates[0].checks.filter((item: { checkId: string }) => item.checkId !== 'margin.end_material');
  else { check.measured = measured; check.state = state; }
  if (historical) {
    const newer = structuredClone(bootstrap.candidates[0]);
    newer.revisionId = 'synthetic_newer_revision';
    newer.checks.find((item: { checkId: string }) => item.checkId === 'margin.end_material').measured = { measuredValue: 99 };
    bootstrap.candidates.push(newer);
    bootstrap.design.selectedCandidateRevisionId = newer.revisionId;
  }
  const snapshot = {
    bootstrap, history: { acceptances: [], manifests: [] }, reference: null, activity: [], globalCursor: 0,
    draft: { lengthMm: '36', instruction: 'Synthetic presentation test' },
    viewedRevisionId: bootstrap.candidates[0].revisionId, trusted: true, loading: false, busy: false,
    error: null, pendingAction: null, canConfirm: false, canRun: false, canAccept: false, canDownload: false,
  };
  const controller = {
    snapshot: () => structuredClone(snapshot), subscribe: () => () => {},
  } as unknown as LiveWorkspaceController;
  const nodes = new Map<string, Element>();
  const document = {
    getElementById(id: string) { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id)!; },
    createElement: (tag: string) => new Element(tag),
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const abort = new AbortController();
  try {
    mountLive(controller, abort.signal, () => { assert.fail('Inactive presentation must not request a preview'); });
    const row = nodes.get('live-checks')!.children.find(item => item.all().some(node => node.dataset.checkId === 'margin.end_material'));
    assert.ok(row, 'Required margin row is missing');
    const summary = row.all().find(node => node.className === 'wk-margin-evidence');
    assert.ok(summary, 'Required margin row needs an explicit measurement or unavailable summary');
    return {
      text: summary.textContent,
      checkState: row.all().find(node => node.className === 'wk-check-state')!.textContent,
      selected: snapshot.bootstrap.design.selectedCandidateRevisionId,
      viewed: snapshot.viewedRevisionId,
    };
  } finally {
    abort.abort();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('live margin uses the observed measuredValue and preserves the provided check status', () => {
  const result = renderedMargin({ measurement: { distances: [99, 99], closestPointPairs: [] }, coreMethod: 'synthetic', measuredValue: 2 }, 'failed');
  assert.equal(result.text, '2 mm measured / 5 mm minimum');
  assert.equal(result.checkState, 'failed');
  assert.equal(renderedMargin({ measuredValue: 5 }).text, '5 mm measured / 5 mm minimum');
  assert.equal(renderedMargin({ fixture: true, minimumEndMaterialMm: 2 }).text, '2 mm measured / 5 mm minimum');
});

test('missing or malformed measurements display unavailable without a legacy conflict fallback', () => {
  for (const measured of [undefined, null, {}, [], 5, { measuredValue: null },
    { measuredValue: '5', minimumEndMaterialMm: 2 }, { measuredValue: false },
    { measuredValue: {}, minimumEndMaterialMm: 2 }]) {
    const result = renderedMargin(measured, 'not_evaluated');
    assert.match(result.text, /measurement unavailable/i);
    assert.doesNotMatch(result.text, /undefined|NaN|\b2 mm measured\b/);
    assert.equal(result.checkState, 'not_evaluated');
  }
});

test('historical inspection formats its own check without borrowing the server selection measurement', () => {
  const result = renderedMargin({ measuredValue: 2 }, 'failed', true);
  assert.equal(result.text, '2 mm measured / 5 mm minimum');
  assert.notEqual(result.selected, result.viewed);
  assert.equal(result.selected, 'synthetic_newer_revision');
});

test('endMaterialMeasurement accepts only finite numeric evidence and prefers the current field', async () => {
  const { endMaterialMeasurement } = await import(presentationPath);
  assert.equal(typeof endMaterialMeasurement, 'function');
  for (const value of [0, 2, 5.125, -1]) {
    assert.equal(endMaterialMeasurement({ measuredValue: value, minimumEndMaterialMm: 99 }), value);
    assert.equal(endMaterialMeasurement({ fixture: true, minimumEndMaterialMm: value }), value);
  }
  for (const value of [undefined, null, '5', false, {}, [], NaN, Infinity, -Infinity]) {
    assert.equal(endMaterialMeasurement({ measuredValue: value, minimumEndMaterialMm: 2 }), null);
    assert.equal(endMaterialMeasurement({ fixture: true, minimumEndMaterialMm: value }), null);
  }
  for (const measured of [undefined, null, [], {}, 5, '5']) assert.equal(endMaterialMeasurement(measured), null);
});
