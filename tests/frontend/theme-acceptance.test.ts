// OUTSIDE_WRAPPER: preregistered behavior after removing the large theme presentation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../../src/client/theme.js', import.meta.url), 'utf8');
const expected = JSON.parse(await readFile(new URL('./home-polish-expected.json', import.meta.url), 'utf8')) as {
  theme_colors: Record<string, string>;
};

function themePage(initialUrl: string) {
  let location = new URL(initialUrl);
  const dataset = { theme: 'frost' };
  const meta = { content: expected.theme_colors.frost };
  const pageEvents = new Map<string, () => void>();
  const buttons = Object.keys(expected.theme_colors).map(name => {
    const events = new Map<string, () => void>();
    const attributes = new Map([['aria-pressed', String(name === 'frost')]]);
    return {
      dataset: { setTheme: name },
      setAttribute(key: string, value: string) { attributes.set(key, value); },
      addEventListener(key: string, action: () => void) { events.set(key, action); },
      selected: () => attributes.get('aria-pressed') === 'true',
      click() { const action = events.get('click'); assert.ok(action, 'Theme button has no activation handler'); action(); },
    };
  });
  const document = {
    documentElement: { dataset },
    querySelector(selector: string) { assert.equal(selector, 'meta[name="theme-color"]'); return meta; },
    querySelectorAll(selector: string) { assert.equal(selector, '[data-set-theme]'); return buttons; },
    getElementById(identity: string) { assert.fail(`Removed presentation element is still required: ${identity}`); },
  };
  const window = {
    get location() { return location; },
    history: { replaceState(_state: unknown, _title: string, url: string | URL) { location = new URL(url.toString(), location); } },
    addEventListener(name: string, action: () => void) { pageEvents.set(name, action); },
  };
  vm.runInNewContext(source, { document, window, URL, URLSearchParams });
  return {
    buttons, dataset, meta,
    url: () => location.toString(),
    backTo(url: string) { location = new URL(url); const action = pageEvents.get('popstate'); assert.ok(action); action(); },
  };
}

test('header themes initialize from shared URLs without removed presentation nodes', () => {
  for (const [name, color] of Object.entries(expected.theme_colors)) {
    const page = themePage(`https://worldkinetics.app/?theme=${name}`);
    assert.equal(page.dataset.theme, name);
    assert.equal(page.meta.content, color);
    assert.deepEqual(page.buttons.filter(button => button.selected()).map(button => button.dataset.setTheme), [name]);
  }
});

test('theme activation preserves URL context, selected state, reload and browser navigation', () => {
  const initial = 'https://worldkinetics.app/?source=example#possibilities';
  const page = themePage(initial);
  assert.equal(page.dataset.theme, 'frost');
  for (const [name, color] of Object.entries(expected.theme_colors)) {
    page.buttons.find(button => button.dataset.setTheme === name)!.click();
    assert.equal(page.dataset.theme, name);
    assert.equal(page.meta.content, color);
    assert.deepEqual(page.buttons.filter(button => button.selected()).map(button => button.dataset.setTheme), [name]);
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('theme'), name);
    assert.equal(url.searchParams.get('source'), 'example');
    assert.equal(url.hash, '#possibilities');
    assert.equal(themePage(page.url()).dataset.theme, name);
  }
  page.backTo(initial);
  assert.equal(page.dataset.theme, 'frost');
  assert.deepEqual(page.buttons.filter(button => button.selected()).map(button => button.dataset.setTheme), ['frost']);
});
