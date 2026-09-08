import { expectedForCheck } from '../../shared/contracts-v2.js';
import type { LiveWorkspaceController } from './live-state.js';
import { createLivePresentation, type LivePresentationUpdate } from './live-presentation.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { element(id).textContent = value; };
const option = (value: string, label: string) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function mountLive(controller: LiveWorkspaceController, signal: AbortSignal, updatePreview: (update: LivePresentationUpdate) => void) {
  const length = element<HTMLInputElement>('live-length');
  const instruction = element<HTMLTextAreaElement>('live-request');
  const revision = element<HTMLSelectElement>('live-revision');
  const comparison = element<HTMLSelectElement>('live-comparison');
  const artifact = element<HTMLSelectElement>('live-artifact');
  const eventRun = element<HTMLSelectElement>('live-event-run');
  const presentation = createLivePresentation();
  let serverSelection: string | null = null;
  let previewFailed = false;
  let active = false;
  let initialized = false;
  let poll: ReturnType<typeof setTimeout> | undefined;

  function render() {
    const s = controller.snapshot(), b = s.bootstrap;
    if (s.trusted && !s.loading) {
      const selected = b?.design?.selectedCandidateRevisionId ?? null;
      if (selected && selected !== serverSelection) comparison.value = 'candidate';
      serverSelection = selected;
    }
    const display = presentation.update(s, comparison.value === 'baseline' ? 'baseline' : 'candidate', active);
    const candidate = b?.candidates.find(item => item.revisionId === s.viewedRevisionId);
    const requirements = b?.requirements;
    const latest = s.history && [...s.history.acceptances].sort((a, z) => z.stateVersion - a.stateVersion)[0];
    const manifest = latest && s.history?.manifests.find(item => item.acceptanceId === latest.acceptanceId);
    if (length.value !== s.draft.lengthMm) length.value = s.draft.lengthMm;
    if (instruction.value !== s.draft.instruction) instruction.value = s.draft.instruction;
    text('live-status', s.error ? `${s.error}${s.bootstrap ? ' Summary records are from the last verified snapshot; preview and acceptance are blocked.' : ''}` : (s.loading ? 'Verifying refreshed records. Any retained mesh and checks are from the last verified snapshot; actions are blocked.'
      : s.busy ? 'Sending explicit action and reconciling state...'
        : s.trusted ? 'API records verified. Inspect the revision and its checks before accepting.' : 'Live workspace unavailable. Reconnect to retry.'));
    element('live-status').dataset.error = String(Boolean(s.error));
    for (const [id, enabled] of [['live-confirm', s.canConfirm], ['live-run', s.canRun], ['live-accept', display.canAccept], ['live-download', s.canDownload],
      ['live-retry', Boolean(s.pendingAction) && !s.busy && !s.loading], ['live-refresh', !s.busy && !s.loading], ['live-reconnect', !s.busy && !s.loading]] as const) {
      element<HTMLButtonElement>(id).disabled = !enabled;
    }
    text('live-run-gate', s.busy ? 'Sending the explicit action and refreshing current state.' : s.pendingAction ? `Uncertain ${s.pendingAction} action. Reconnect and explicitly retry the same request.`
      : b?.design?.acceptedRevisionId ? 'This release runs numeric changes only from the baseline before acceptance.'
        : b?.executionMode !== 'live' ? b?.unavailableReason ?? 'New execution is unavailable.'
          : b.design?.activeRunId ? 'A run is active. Wait for its observed result.'
            : 'Confirm a finite length from 26 to 200 mm, then request a separate run using that confirmed length.');
    text('live-accept-gate', display.canAccept ? `Accept ${b?.design?.selectedCandidateRevisionId} with its verified current checks.`
      : 'Acceptance requires the server-selected live revision to render successfully in candidate comparison with verified current checks.');
    text('live-export-gate', s.canDownload ? 'Download uses the latest acceptance and registered manifest, independent of the inspected revision.'
      : 'Export requires a reconciled live acceptance matching the full current requirements. Refresh if state and history disagree.');
    text('live-requirements', requirements ? `${requirements.setup.dimensions.lengthMm} mm length · requirements v${requirements.requirementsVersion}` : 'Unavailable');
    text('live-fixed', requirements ? `Width ${requirements.setup.dimensions.widthMm} · thickness ${requirements.setup.dimensions.baseThicknessMm} · bore diameter ${requirements.setup.holes.diameterMm} · pitch ${requirements.setup.holes.spacingMm} · minimum end material ${requirements.setup.minimumEndMaterialMm} mm` : 'No verified requirements');
    text('live-selection', b?.design ? `Selected: ${b.design.selectedCandidateRevisionId ?? 'none'} · state v${b.design.stateVersion}` : 'No current design');
    const run = b?.runs.find(item => item.runId === (b.design?.activeRunId ?? candidate?.runId));
    text('live-run-status', run ? `${run.runId}: ${run.status}${run.error ? ` · ${run.error.message}` : ''}` : 'No active run');
    revision.replaceChildren(...(b?.candidates.map(item => option(item.revisionId,
      `${item.revisionId} · ${item.requirements.setup.dimensions.lengthMm} mm · v${item.requirementsVersion} · ${item.status}${item.revisionId === b.design?.selectedCandidateRevisionId ? ' · selected' : ' · history'}`)) ?? []));
    if (s.viewedRevisionId) revision.value = s.viewedRevisionId;
    if (!candidate) revision.prepend(option('', 'No candidate selected'));
    revision.disabled = s.loading || !b?.candidates.length;
    text('live-candidate-status', candidate ? `${candidate.revisionId === b?.design?.selectedCandidateRevisionId ? 'Server-selected candidate' : 'Local historical inspection'} · ${candidate.revisionId} · ${candidate.status} · ${candidate.executionMode} · requirements v${candidate.requirementsVersion}${candidate.error ? ` · ${candidate.error.message}` : ''}` : 'No candidate evidence. Baseline geometry is not candidate evidence.');
    const r = s.trusted && !s.error ? candidate?.requirements : undefined;
    if (display.evidenceAction === 'replace') {
      text('live-check-count', r ? `${candidate!.checks.filter(check => check.state === 'passed').length}/${r.requiredChecks.length} passed` : 'No verified checks');
      const expandedChecks = new Set(Array.from(element('live-checks').querySelectorAll<HTMLDetailsElement>('details[open]')).map(node => node.dataset.checkId));
      element('live-checks').replaceChildren(...(r?.requiredChecks.map(id => {
        const check = candidate?.checks.find(item => item.checkId === id);
        const row = document.createElement('tr'), heading = document.createElement('th'), cell = document.createElement('td');
        heading.scope = 'row';
        const details = document.createElement('details'), summary = document.createElement('summary'), evidence = document.createElement('pre');
        details.dataset.checkId = id;
        details.open = expandedChecks.has(id);
        summary.textContent = check?.label ?? id;
        evidence.textContent = pretty({ checkId: id, measured: check?.measured ?? null, expected: expectedForCheck(r, id), units: check?.units,
          method: check?.method, details: check?.details, diagnostics: check?.diagnostics });
        details.append(summary, evidence); heading.append(details);
        const state = document.createElement('span'); state.className = 'wk-check-state'; state.dataset.state = check?.state ?? 'not_evaluated'; state.textContent = state.dataset.state;
        cell.append(state);
        if (id === 'margin.end_material' && check?.measured && typeof check.measured === 'object' && !Array.isArray(check.measured)) {
          const margin = document.createElement('p'); margin.className = 'wk-margin-evidence';
          margin.textContent = `${check.measured.minimumEndMaterialMm} mm measured / ${r.setup.minimumEndMaterialMm} mm minimum`; cell.append(margin);
        }
        row.append(heading, cell); return row;
      }) ?? []));
    }
    text('live-evidence', candidate ? pretty({ revisionId: candidate.revisionId, runId: candidate.runId, requirementsId: candidate.requirementsId,
      requirementsVersion: candidate.requirementsVersion, geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash,
      engine: candidate.engine, artifacts: candidate.artifacts }) : 'No candidate evidence');
    text('live-accepted', latest ? `${latest.candidate.revisionId} · ${latest.acceptanceId} · accepted at state v${latest.stateVersion} · ${b?.design?.acceptedRequirementsMatch ? 'current requirements' : 'historical requirements'}` : 'No accepted revision.');
    const previousArtifact = artifact.value;
    artifact.replaceChildren(...(manifest?.artifacts.map(item => option(item.artifactId, `${item.fileName} · ${item.bytes} bytes`)) ?? []));
    if (manifest?.artifacts.some(item => item.artifactId === previousArtifact)) artifact.value = previousArtifact;
    artifact.disabled = !s.canDownload;
    element('live-history').replaceChildren(...(s.history?.acceptances.map(item => {
      const entry = document.createElement('li');
      entry.textContent = `${item.acceptanceId} · ${item.candidate.revisionId} · state v${item.stateVersion} · requirements v${item.requirements.requirementsVersion}`; return entry;
    }) ?? []));
    const previousRun = eventRun.value;
    eventRun.replaceChildren(option('', 'All runs and design events'), ...(b?.runs.map(item => option(item.runId, `${item.runId} · requirements v${item.requirementsVersion}`)) ?? []));
    if (b?.runs.some(item => item.runId === previousRun)) eventRun.value = previousRun;
    text('live-cursor', `Global event cursor ${s.globalCursor}. Independent of design state v${b?.design?.stateVersion ?? 'unavailable'}.`);
    element('live-activity').replaceChildren(...s.activity.filter(item => (!b?.design || item.designId === b.design.designId) && (!eventRun.value || item.runId === eventRun.value)).map(item => {
      const entry = document.createElement('li'); entry.textContent = `#${item.eventId} ${item.type} · ${item.revisionId ?? 'design'} · requirements v${item.requirementsVersion} · state v${item.stateVersion}`; return entry;
    }));
    if (active && display.previewAction !== 'retain') {
      if (display.previewAction === 'load') previewFailed = false;
      updatePreview(display);
    }
    return display;
  }

  async function save(result: Awaited<ReturnType<LiveWorkspaceController['exportArtifact']>>) {
    if (!result) { text('live-download-status', 'No download produced. Review the connection or evidence message.'); return; }
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([result.bytes], { type: result.artifact.mediaType }));
      const link = document.createElement('a'); link.href = url; link.download = result.artifact.fileName;
      document.body.append(link); link.click(); link.remove();
      text('live-download-status', `Verified ${result.artifact.fileName} · ${result.bytes.byteLength} bytes · SHA-256 ${result.artifact.sha256}`);
    } catch { text('live-download-status', 'The file verified, but the browser could not start the download. Retry explicitly.'); }
    finally { if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000); } }
  }

  function schedulePoll() {
    if (poll) clearTimeout(poll);
    if (!active || signal.aborted) return;
    poll = setTimeout(async () => {
      const s = controller.snapshot();
      if (!s.loading && !s.busy && !s.error && !s.pendingAction) await controller.poll();
      schedulePoll();
    }, 5000);
  }
  length.addEventListener('input', () => controller.setDraft({ lengthMm: length.value }), { signal });
  instruction.addEventListener('input', () => controller.setDraft({ instruction: instruction.value }), { signal });
  revision.addEventListener('change', () => { comparison.value = 'candidate'; controller.selectRevision(revision.value); }, { signal });
  comparison.addEventListener('change', render, { signal });
  eventRun.addEventListener('change', render, { signal });
  for (const [id, action] of [['live-confirm', controller.confirmRequirements], ['live-run', controller.requestRun],
    ['live-refresh', controller.refresh], ['live-reconnect', controller.reconnect]] as const) {
    element(id).addEventListener('click', () => {
      if (previewFailed && (id === 'live-refresh' || id === 'live-reconnect')) presentation.invalidate();
      void action();
    }, { signal });
  }
  element('live-accept').addEventListener('click', () => {
    if (render().canAccept) void controller.acceptRevision();
  }, { signal });
  element('live-download').addEventListener('click', () => { void controller.exportArtifact(artifact.value).then(save); }, { signal });
  element('live-retry').addEventListener('click', () => {
    const download = controller.snapshot().pendingAction === 'export';
    void controller.retryPending().then(result => { if (download) return save(result); });
  }, { signal });
  const unsubscribe = controller.subscribe(render);
  signal.addEventListener('abort', () => { presentation.invalidate(); unsubscribe(); if (poll) clearTimeout(poll); }, { once: true });
  render();
  return {
    open() { active = true; if (!initialized) { initialized = true; void controller.load(); } else { void controller.reconnect(); } schedulePoll(); },
    close() { active = false; render(); if (poll) clearTimeout(poll); },
    comparison: () => comparison.value,
    rendered(key: string) { presentation.rendered(key); previewFailed = false; render(); },
    failed(key: string) { presentation.failed(key); previewFailed = true; render(); },
    retryPreview() { presentation.invalidate(); render(); },
  };
}
