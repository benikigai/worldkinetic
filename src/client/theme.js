const themes = {
  frost: {
    color: '#f3f5f5',
  },
  graphite: {
    color: '#171b1d',
  },
  canvas: {
    color: '#f2eee5',
  },
};

function applyTheme(name, updateUrl = false) {
  if (!Object.hasOwn(themes, name)) return;
  const theme = themes[name];
  document.documentElement.dataset.theme = name;
  document.querySelector('meta[name="theme-color"]').content = theme.color;
  for (const button of document.querySelectorAll('[data-set-theme]')) {
    button.setAttribute('aria-pressed', String(button.dataset.setTheme === name));
  }
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('theme', name);
    window.history.replaceState(null, '', url);
  }
}

for (const button of document.querySelectorAll('[data-set-theme]')) {
  button.addEventListener('click', () => applyTheme(button.dataset.setTheme, true));
}

applyTheme(new URLSearchParams(window.location.search).get('theme') || 'frost');
window.addEventListener('popstate', () => applyTheme(new URLSearchParams(window.location.search).get('theme') || 'frost'));
