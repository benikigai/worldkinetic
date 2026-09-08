import { mountSession } from './session.js';
import { MAX_PREVIEW_BYTES, parsePreviewGeometry } from './preview.js';
import { PreviewViewer, type ViewName } from './viewer.js';
import { mountReview } from './review.js';
import { createLiveWorkspaceController } from './live-state.js';
import { mountLive } from './live.js';
import reviewableFixture from '../../../fixtures/api/v2/reviewable.fixture.json' with { type: 'json' };
import rejectedFixture from '../../../fixtures/api/v2/rejected.fixture.json' with { type: 'json' };
import featureRequirements from '../../../fixtures/api/v2/feature-requirements.fixture.json' with { type: 'json' };
import eventFixture from '../../../fixtures/api/v2/event.fixture.json' with { type: 'json' };

const fixtures = {
  original: {
    name: 'Saved original reference',
    url: '/workspace/fixtures/saved-references/mcp-test-plate.stl',
    source: 'examples/plate/original/mcp-test-plate.stl',
    sha256: 'e078a52ece47d126ca7a22d19070e73d170b709f14847359e94252379f0ed76c',
  },
  revised: {
    name: 'Saved revised baseline',
    url: '/workspace/fixtures/saved-references/plate-50x35x5.stl',
    source: 'examples/plate/revised/plate-50x35x5.stl',
    sha256: 'be0f4113c8b12339f37d7a34cbb1b967b22fae6c13bbcabd156a591480dc2d4a',
  },
} as const;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reference = element<HTMLSelectElement>('reference');
const scenario = element<HTMLSelectElement>('scenario');
const theme = element<HTMLSelectElement>('theme');
const wireframe = element<HTMLInputElement>('wireframe');
const viewport = element<HTMLDivElement>('viewport');
const message = element<HTMLDivElement>('preview-message');
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
const listeners = new AbortController();
let viewer: PreviewViewer | undefined;
let request: AbortController | undefined;
let selectionToken = 0;
let webglError = '';
let mode: 'saved' | 'review' | 'live' = 'saved';
const liveController = createLiveWorkspaceController({ fetch: window.fetch.bind(window) });
const live = mountLive(liveController, listeners.signal, update => { void loadSelection(update.previewKey); });
const review = mountReview({
  history: { ...reviewableFixture, runs: [...reviewableFixture.runs, ...rejectedFixture.runs],
    candidates: [...reviewableFixture.candidates, ...rejectedFixture.candidates] },
  feature: { ...reviewableFixture, requirements: featureRequirements, runs: [], candidates: [],
    design: { ...reviewableFixture.design, designId: featureRequirements.designId,
      setupId: featureRequirements.setupId, setupHash: featureRequirements.setupHash,
      referenceId: featureRequirements.referenceId, referenceHash: featureRequirements.referenceHash,
      activeRequirementsVersion: featureRequirements.requirementsVersion,
      selectedCandidateRevisionId: null, activeRunId: null } },
  event: eventFixture,
}, listeners.signal);

function setStatus(title: string, detail: string, ready = false) {
  element('preview-status').textContent = title;
  element('preview-detail').textContent = detail;
  message.hidden = ready;
  viewport.setAttribute('aria-busy', String(title.startsWith('Loading')));
  for (const button of viewButtons) button.disabled = !ready;
  wireframe.disabled = !ready;
}

function clearIdentity() {
  element('identity-status').textContent = 'No preview';
  element('identity-dimensions').textContent = 'Unavailable';
  element('mesh-dimensions').textContent = 'No mesh loaded';
  element('identity-hash').textContent = 'Not verified';
  element('full-hash').textContent = 'Not verified';
}

function graphicsUnavailable(detail: string) {
  request?.abort();
  selectionToken++;
  webglError = detail;
  if (mode === 'live') live.retryPreview();
  clearIdentity();
  setStatus('WebGL preview unavailable', detail);
}

async function download(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Saved preview could not be loaded (HTTP ${response.status}). Select a saved reference to recover.`);
  }
  if (Number(response.headers.get('content-length')) > MAX_PREVIEW_BYTES) {
    await response.body?.cancel();
    throw new Error('STL preview exceeds the 25 MB limit.');
  }
  if (!response.body) throw new Error('Saved preview response has no data.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PREVIEW_BYTES) {
        await reader.cancel();
        throw new Error('STL preview exceeds the 25 MB limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function loadSelection(previewKey: string | null = null) {
  const token = ++selectionToken;
  request?.abort();
  request = new AbortController();
  const signal = request.signal;
  viewer?.clear();
  clearIdentity();
  if (mode === 'review') {
    setStatus('Candidate geometry unavailable', 'Synthetic review fixtures contain NON-CAD strings. No saved reference mesh is displayed.');
    return;
  }
  if (mode === 'live') {
    await loadLivePreview(token, signal, previewKey);
    return;
  }
  const fixture = fixtures[reference.value === 'original' ? 'original' : 'revised'];
  const saved = scenario.value === 'saved';
  element('identity-title').textContent = saved ? fixture.name : `${scenario.value === 'empty' ? 'Empty' : 'Unavailable'} preview scenario`;
  element('identity-source').textContent = saved ? fixture.source : 'Fixture-only scenario. No reference mesh is displayed.';
  if (!viewer?.available) {
    setStatus('WebGL preview unavailable', webglError || 'This browser could not start WebGL. Enable hardware graphics support and reload the page.');
    return;
  }
  if (scenario.value === 'empty') {
    setStatus('No preview selected', 'This is the empty fixture scenario. Load a saved reference to inspect its mesh.');
    return;
  }
  setStatus('Loading saved reference', saved ? 'Fetching STL bytes and verifying their SHA-256 identity.' : 'Requesting the intentionally unavailable fixture.');
  element('identity-status').textContent = 'Loading';
  try {
    const url = saved ? fixture.url : '/workspace/fixtures/unavailable-preview.stl';
    const bytes = await download(url, signal);
    if (token !== selectionToken || signal.aborted) return;
    if (!saved) throw new Error('The unavailable fixture scenario has no registered preview.');
    const geometry = await parsePreviewGeometry(bytes, fixture.sha256);
    if (token !== selectionToken || signal.aborted) { geometry.dispose(); return; }
    const dimensions = viewer.show(geometry, wireframe.checked);
    const measured = dimensions.map((value) => Number(value.toFixed(3)).toString()).join(' × ');
    element('identity-status').textContent = 'Ready · fixture';
    element('identity-dimensions').textContent = measured;
    element('mesh-dimensions').textContent = `${measured} mm`;
    element('identity-hash').textContent = `${fixture.sha256.slice(0, 12)}… verified`;
    element('full-hash').textContent = fixture.sha256;
    setStatus('Fixture preview ready', `${fixture.name}. Mesh bounds ${measured} millimeters.`, true);
  } catch (error) {
    if (token !== selectionToken || signal.aborted) return;
    viewer?.clear();
    clearIdentity();
    element('identity-status').textContent = 'Unavailable';
    setStatus('Preview unavailable', error instanceof Error ? error.message : 'The saved STL could not be loaded. Reload the saved reference to retry.');
  }
}

async function loadLivePreview(token: number, signal: AbortSignal, previewKey: string | null) {
  const s = liveController.snapshot();
  const baseline = live.comparison() === 'baseline';
  const candidate = s.bootstrap?.candidates.find(item => item.revisionId === s.viewedRevisionId);
  const requirements = s.bootstrap?.requirements;
  const initial = requirements?.registryId === 'handle_sample_v1' && requirements.setup.acceptedInitial
    ? s.history?.acceptances.find(item => item.acceptanceId === requirements.setup.acceptedInitial?.acceptanceId)?.candidate : null;
  const label = baseline ? (initial ? `Accepted starting design · ${initial.revisionId}` : `Two-pad mounting reference · ${s.reference?.revisionId ?? 'unavailable'}`)
    : `Inspected ${candidate?.revisionId === s.bootstrap?.design?.selectedCandidateRevisionId ? 'selected' : 'historical'} candidate · ${candidate?.revisionId ?? 'none'}`;
  element('live-mesh-identity').textContent = label;
  element('model-title').textContent = baseline ? (initial ? 'Before · starting design' : 'Before · mounting pads') : 'Your design';
  if (!s.trusted || s.loading || s.error) {
    element('model-title').textContent = 'Your design';
    setStatus(s.loading ? 'Loading your design…' : 'Your design will appear here', s.loading ? '' : 'Connect to the demo to create and review a handle.');
    return;
  }
  if (requirements?.registryId !== 'handle_sample_v1' || s.bootstrap?.executionMode === 'fixture') {
    if (previewKey) live.failed(previewKey);
    setStatus('Handle preview unavailable', 'This connection has no verified live handle workspace. Saved and synthetic examples remain explicitly labeled in Test data.');
    return;
  }
  if (!baseline && !candidate) {
    setStatus('No candidate preview', 'Confirm the sample sizes, create your handle, then review its shape here.');
    return;
  }
  if (!previewKey) {
    setStatus('Live preview unavailable', 'No verified registered STL is available for this comparison.');
    return;
  }
  if (!viewer?.available) {
    live.failed(previewKey);
    setStatus('WebGL preview unavailable', webglError || 'Enable hardware graphics support and reload.');
    return;
  }
  setStatus('Loading registered STL', `${label}. Verifying media type, byte count and SHA-256.`);
  try {
    const preview = await liveController.preview(baseline ? initial?.revisionId ?? null : candidate!.revisionId);
    if (token !== selectionToken || signal.aborted) return;
    if (!preview) {
      live.failed(previewKey);
      setStatus('Registered preview unavailable', liveController.snapshot().error ?? 'This revision has no verified STL bytes. Refresh to retry.');
      return;
    }
    const geometry = await parsePreviewGeometry(preview.bytes, preview.artifact.sha256);
    if (token !== selectionToken || signal.aborted) { geometry.dispose(); return; }
    const dimensions = viewer.show(geometry, wireframe.checked);
    if (token !== selectionToken || signal.aborted || !viewer.available) return;
    live.rendered(previewKey);
    const measured = dimensions.map(value => Number(value.toFixed(3))).join(' × ');
    element('mesh-dimensions').textContent = `${measured} mm · mesh bounds`;
    element('live-mesh-identity').textContent = `${label} · ${preview.artifact.artifactId} · ${preview.bytes.byteLength} bytes · STL SHA-256 ${preview.artifact.sha256}`;
    setStatus('Registered STL ready', label, true);
  } catch {
    if (token !== selectionToken || signal.aborted) return;
    viewer.clear();
    live.failed(previewKey);
    element('mesh-dimensions').textContent = 'No mesh loaded';
    setStatus('Registered STL preview failed', 'The registered bytes could not be safely rendered. Refresh to retry. No substitute mesh is shown.');
  }
}

function applyTheme() {
  const selected = ['frost', 'graphite', 'canvas'].includes(theme.value) ? theme.value : 'frost';
  document.documentElement.dataset.theme = selected;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  viewer?.setTheme();
}

const requestedTheme = new URLSearchParams(window.location.search).get('theme');
if (requestedTheme && ['frost', 'graphite', 'canvas'].includes(requestedTheme)) theme.value = requestedTheme;
applyTheme();
try {
  viewer = new PreviewViewer(viewport, graphicsUnavailable, () => {
    webglError = '';
    if (mode === 'live') live.retryPreview();
    else void loadSelection();
  });
} catch {
  graphicsUnavailable('This browser could not start WebGL. Enable hardware graphics support and reload the page. Reference information and theme controls remain available.');
}

reference.addEventListener('change', () => { scenario.value = 'saved'; void loadSelection(); }, { signal: listeners.signal });
function switchMode(next: 'saved' | 'review' | 'live') {
  if (mode === next) return;
  live.close();
  mode = next;
  document.querySelectorAll<HTMLElement>('[data-saved-only]').forEach(node => { node.hidden = mode !== 'saved'; });
  document.querySelectorAll<HTMLElement>('[data-review-only]').forEach(node => { node.hidden = mode !== 'review'; });
  document.querySelectorAll<HTMLElement>('[data-live-only]').forEach(node => { node.hidden = mode !== 'live'; });
  document.querySelectorAll<HTMLElement>('[data-viewer-only]').forEach(node => { node.hidden = mode === 'review'; });
  document.querySelectorAll<HTMLElement>('[data-offline-only]').forEach(node => { node.hidden = mode === 'live'; });
  element('model-title').textContent = mode === 'live' ? 'Handle mounting reference' : 'Reference geometry';
  element('live-mode').setAttribute('aria-pressed', String(mode === 'live'));
  element('saved-mode').setAttribute('aria-pressed', String(mode === 'saved'));
  element('review-mode').setAttribute('aria-pressed', String(mode === 'review'));
  if (mode !== 'live') void loadSelection();
  if (mode === 'review') review.open();
  if (mode === 'live') live.open();
}
element('live-mode').addEventListener('click', () => switchMode('live'), { signal: listeners.signal });
element('saved-mode').addEventListener('click', () => switchMode('saved'), { signal: listeners.signal });
element('review-mode').addEventListener('click', () => switchMode('review'), { signal: listeners.signal });
scenario.addEventListener('change', () => { void loadSelection(); }, { signal: listeners.signal });
element('reload').addEventListener('click', () => { scenario.value = 'saved'; void loadSelection(); }, { signal: listeners.signal });
theme.addEventListener('change', applyTheme, { signal: listeners.signal });
wireframe.addEventListener('change', () => viewer?.setWireframe(wireframe.checked), { signal: listeners.signal });
for (const button of viewButtons) button.addEventListener('click', () => viewer?.setView(button.dataset.view as ViewName), { signal: listeners.signal });
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  selectionToken++;
  request?.abort();
  listeners.abort();
  viewer?.dispose();
}, { signal: listeners.signal });
const initialMode = new URLSearchParams(window.location.search).get('mode');
let sessionAllowed = false;
mountSession(listeners.signal, allowed => {
  if (allowed === sessionAllowed) return;
  sessionAllowed = allowed;
  if (!allowed) { live.close(); request?.abort(); selectionToken++; viewer?.clear(); return; }
  if (initialMode === 'saved') void loadSelection();
  else if (mode === 'live') live.open();
  else switchMode(initialMode === 'review' ? 'review' : 'live');
});
