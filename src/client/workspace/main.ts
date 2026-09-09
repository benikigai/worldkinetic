import { quoteTotal } from './quote-total.js';
import { loadRecordedDemo, recordedBytes, recordedView } from './recorded-files.js';
import type { SavedHandleDemo } from '../../shared/saved-handle-v2.js';
import { createWorkspaceTransport, mountSession } from './session.js';
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
const recordedComparison = element<HTMLSelectElement>('recorded-comparison');
const recordedFile = element<HTMLSelectElement>('recorded-file');
let recordedDemo: SavedHandleDemo | null = null;
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-set-theme]'));
const wireframe = element<HTMLInputElement>('wireframe');
const viewport = element<HTMLDivElement>('viewport');
const message = element<HTMLDivElement>('preview-message');
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
const listeners = new AbortController();
let viewer: PreviewViewer | undefined;
let request: AbortController | undefined;
let selectionToken = 0;
let webglError = '';
let mode: 'saved' | 'review' | 'live' | 'recorded' = 'saved';
const workspaceTransport = createWorkspaceTransport(window.fetch.bind(window));
const liveController = createLiveWorkspaceController({ fetch: workspaceTransport.fetch });
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
  if (mode === 'recorded') {
    await loadRecordedPreview(token, signal);
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

async function loadRecordedPreview(token: number, signal: AbortSignal) {
  element<HTMLButtonElement>('recorded-download').disabled = true;
  recordedFile.disabled = true;
  setStatus('Loading recorded handle…', 'Checking the approved file identity.');
  try {
    if (!recordedDemo) recordedDemo = await loadRecordedDemo(window.fetch.bind(window), signal);
    if (token !== selectionToken || signal.aborted) return;
    const side = recordedComparison.value === 'before' ? 'before' : 'after';
    const view = recordedView(recordedDemo, side);
    const previous = recordedFile.value;
    recordedFile.replaceChildren(...view.files.map(file => { const option = document.createElement('option'); option.value = file.id; option.textContent = file.label; return option; }));
    if (view.files.some(file => file.id === previous)) recordedFile.value = previous;
    recordedFile.disabled = false;
    element<HTMLButtonElement>('recorded-download').disabled = false;
    element('recorded-download-status').textContent = '';
    element('recorded-summary').textContent = `${side === 'before' ? 'Curved starting handle' : 'Broader grip with a thumb rest'} · ${view.manifest.checks.filter(check => check.state === 'passed').length} checks passed in the recorded run.`;
    element('model-title').textContent = side === 'before' ? 'Before · curved handle' : 'After · broader grip';
    if (!viewer?.available) { setStatus('3D preview unavailable', 'You can still download the approved files.'); return; }
    const bytes = await recordedBytes(window.fetch.bind(window), view.previewFile.href, view.previewFile.bytes, view.previewFile.sha256, signal);
    const geometry = await parsePreviewGeometry(bytes, view.previewFile.sha256);
    if (token !== selectionToken || signal.aborted) { geometry.dispose(); return; }
    const dimensions = viewer.show(geometry, wireframe.checked);
    element('mesh-dimensions').textContent = `${dimensions.map(value => Number(value.toFixed(2))).join(' × ')} mm · measured mesh bounds`;
    setStatus('Recorded handle ready', 'Approved example, not a new generation.', true);
  } catch (error) {
    if (token !== selectionToken || signal.aborted) return;
    viewer?.clear(); clearIdentity();
    element('recorded-summary').textContent = 'Recorded example unavailable. Reload to try again.';
    setStatus('Recorded example unavailable', error instanceof Error ? error.message : 'The approved files could not be verified.');
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

function applyTheme(name: string, updateUrl = false) {
  const selected = ['frost', 'graphite', 'canvas'].includes(name) ? name : 'frost';
  document.documentElement.dataset.theme = selected;
  for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.setTheme === selected));
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  viewer?.setTheme();
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('theme', selected);
    window.history.replaceState(null, '', url);
  }
}

applyTheme(new URLSearchParams(window.location.search).get('theme') || 'frost');
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
function switchMode(next: 'saved' | 'review' | 'live' | 'recorded') {
  if (mode === next) return;
  live.close();
  mode = next;
  document.body.dataset.workspaceMode = mode;
  document.querySelectorAll<HTMLElement>('[data-saved-only]').forEach(node => { node.hidden = mode !== 'saved'; });
  document.querySelectorAll<HTMLElement>('[data-review-only]').forEach(node => { node.hidden = mode !== 'review'; });
  document.querySelectorAll<HTMLElement>('[data-recorded-only]').forEach(node => { node.hidden = mode !== 'recorded'; });
  document.querySelectorAll<HTMLElement>('[data-live-only]').forEach(node => { node.hidden = mode !== 'live'; });
  document.querySelectorAll<HTMLElement>('[data-viewer-only]').forEach(node => { node.hidden = mode === 'review'; });
  document.querySelectorAll<HTMLElement>('[data-offline-only]').forEach(node => { node.hidden = mode === 'live'; });
  element('model-title').textContent = mode === 'recorded' ? 'Approved handle' : mode === 'live' ? 'Handle mounting reference' : 'Reference geometry';
  element('consumer-title').textContent = mode === 'recorded' ? 'Cabinet handle demo' : 'Make a cabinet handle your own';
  element('consumer-progress').hidden = mode !== 'live';
  if (mode === 'recorded') element('live-stage').textContent = 'Recorded example';
  element('live-mode').setAttribute('aria-pressed', String(mode === 'live'));
  element('saved-mode').setAttribute('aria-pressed', String(mode === 'saved'));
  element('review-mode').setAttribute('aria-pressed', String(mode === 'review'));
  if (mode !== 'live') void loadSelection();
  if (mode === 'review') review.open();
  if (mode === 'live') live.open();
}
element('live-mode').addEventListener('click', () => { window.location.href = '/workspace/?mode=live'; }, { signal: listeners.signal });
element('saved-mode').addEventListener('click', () => switchMode('saved'), { signal: listeners.signal });
element('review-mode').addEventListener('click', () => switchMode('review'), { signal: listeners.signal });
recordedComparison.addEventListener('change', () => { if (mode === 'recorded') void loadSelection(); }, { signal: listeners.signal });
element('recorded-download').addEventListener('click', () => {
  if (mode !== 'recorded' || !recordedDemo) return;
  const side = recordedComparison.value === 'before' ? 'before' : 'after';
  const file = recordedView(recordedDemo, side).files.find(item => item.id === recordedFile.value);
  if (!file) return;
  const button = element<HTMLButtonElement>('recorded-download'); button.disabled = true;
  element('recorded-download-status').textContent = 'Verifying the approved download…';
  void (async () => {
    let url: string | undefined;
    try {
      const bytes = await recordedBytes(window.fetch.bind(window), file.href, file.bytes, file.sha256, listeners.signal);
      if (mode !== 'recorded' || recordedComparison.value !== side || recordedFile.value !== file.id) throw new Error('The selected version changed. Choose its file and download again.');
      url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
      const link = document.createElement('a'); link.href = url; link.download = file.fileName; document.body.append(link); link.click(); link.remove();
      element('recorded-download-status').textContent = `Verified ${file.fileName}. Check your browser downloads.`;
    } catch (error) { element('recorded-download-status').textContent = error instanceof Error ? error.message : 'No file was downloaded.'; }
    finally { button.disabled = mode !== 'recorded' || !recordedDemo; if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000); } }
  })();
}, { signal: listeners.signal });
scenario.addEventListener('change', () => { void loadSelection(); }, { signal: listeners.signal });
element('reload').addEventListener('click', () => { scenario.value = 'saved'; void loadSelection(); }, { signal: listeners.signal });
for (const button of themeButtons) button.addEventListener('click', () => applyTheme(button.dataset.setTheme || 'frost', true), { signal: listeners.signal });
window.addEventListener('popstate', () => applyTheme(new URLSearchParams(window.location.search).get('theme') || 'frost'), { signal: listeners.signal });
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
if (initialMode !== 'live') {
  element('session-gate').hidden = true;
  element('session-bar').hidden = true;
  element('workspace-content').hidden = false;
  element('recorded-entry').setAttribute('aria-current', 'page');
  switchMode('recorded');
} else {
  element('create-entry').setAttribute('aria-current', 'page');
  let sessionAllowed = false;
  mountSession(listeners.signal, (allowed, workspaceId) => {
    if (allowed === sessionAllowed) return;
    if (allowed) workspaceTransport.bind(workspaceId);
    sessionAllowed = allowed;
    if (!allowed) { live.close(); request?.abort(); selectionToken++; viewer?.clear(); return; }
    if (mode === 'live') live.open();
    else switchMode('live');
  });
}

element('copy-supplier-prompt').addEventListener('click', async () => {
  const prompt = element<HTMLTextAreaElement>('supplier-prompt');
  try {
    await navigator.clipboard.writeText(prompt.value);
    element('supplier-copy-status').textContent = 'Copied. Attach the CAD and brief from your approved package before sending.';
  } catch {
    prompt.focus(); prompt.select();
    element('supplier-copy-status').textContent = 'Select and copy the request above. Clipboard access was unavailable.';
  }
}, { signal: listeners.signal });

function updateQuoteComparison() {
  const totals = ['A', 'B'].map(offer => {
    const total = quoteTotal(['parts', 'shipping', 'fees'].map(field => element<HTMLInputElement>(`quote-${offer}-${field}`).value));
    element(`quote-${offer}-total`).textContent = total === null ? 'Total unknown: enter all three amounts.' : `Total: $${total.toFixed(2)} USD`;
    return total;
  });
  const [a, b] = totals;
  element('quote-comparison').textContent = a === null || b === null ? 'Complete both offers to compare totals.' : a === b ? 'Both offers have the same total.' : `Offer ${a < b ? 'A' : 'B'} is $${Math.abs(a - b).toFixed(2)} USD lower. Compare production and transit times separately.`;
}
for (const offer of ['A', 'B']) for (const field of ['parts', 'shipping', 'fees']) element(`quote-${offer}-${field}`).addEventListener('input', updateQuoteComparison, { signal: listeners.signal });
