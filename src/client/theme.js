const themes = {
  frost: {
    color: '#f3f5f5',
    title: 'Clarity, by design.',
    detail: 'Light. Precise. Human.',
    description: 'Soft white, translucent surfaces, and a quiet blue accent. Space for the object to be the focus.',
  },
  graphite: {
    color: '#171b1d',
    title: 'A different perspective.',
    detail: 'Focused. Tactile. Technical.',
    description: 'Deep graphite, brushed metal, and a pale green accent. A focused studio with a more technical character.',
  },
  canvas: {
    color: '#f2eee5',
    title: 'Made to feel familiar.',
    detail: 'Warm. Thoughtful. Material.',
    description: 'Warm paper, natural materials, and a clay accent. An approachable workshop with a human touch.',
  },
};

function applyTheme(name, updateUrl = false) {
  if (!Object.hasOwn(themes, name)) return;
  const theme = themes[name];
  document.documentElement.dataset.theme = name;
  document.querySelector('meta[name="theme-color"]').content = theme.color;
  document.getElementById('material-title').textContent = theme.title;
  document.getElementById('material-detail').textContent = theme.detail;
  document.getElementById('theme-description').textContent = theme.description;
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
