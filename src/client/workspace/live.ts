import { consumerAction, consumerStep } from './consumer-state.js';
import { expectedForCheck } from '../../shared/contracts-v2.js';
import type { LiveWorkspaceController } from './live-state.js';
import { createLivePresentation, endMaterialMeasurement, type LivePresentationUpdate } from './live-presentation.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { element(id).textContent = value; };
const option = (value: string, label: string) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const friendlyChecks: Record<string, string> = {
  'geometry.valid_single_solid': 'One connected, valid shape',
  'handle.mount_interface': 'Mounting pads stay in place',
  'handle.envelope': 'Fits within the allowed size',
  'handle.grip_clearance': 'Empty space for your fingers',
  'handle.grip_sections': 'Grip stays connected',
  'handle.refinement_delta': 'Broader grip and thumb rest',
  'export.step_reopen': 'STEP file opens correctly',
  'export.stl_reopen': 'STL file opens correctly',
  'export.editable_reopen': 'Editable source recreates the design',
};
export function measuredSummary(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Measurement unavailable';
  const record = value as Record<string, unknown>;
  const measurements = record.measurement ?? record.values ?? record;
  if (!measurements || typeof measurements !== 'object' || Array.isArray(measurements)) return 'Measurement unavailable';
  const lines = Object.entries(measurements).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .slice(0, 5).map(([key, number]) => `${key.replace(/Mm3$/, ' mm³').replace(/Mm2$/, ' mm²').replace(/Mm$/, ' mm').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}: ${Number(number.toFixed(4))}`);
  return lines.length ? lines.join(' · ') : 'See measured evidence in the check details';
}

export function mountLive(controller: LiveWorkspaceController, signal: AbortSignal, updatePreview: (update: LivePresentationUpdate) => void) {
  const length = element<HTMLInputElement>('live-length');
  const instruction = element<HTMLTextAreaElement>('live-request');
  const revision = element<HTMLSelectElement>('live-revision');
  const comparison = element<HTMLSelectElement>('live-comparison');
  const artifact = element<HTMLSelectElement>('live-artifact');
  const eventRun = element<HTMLSelectElement>('live-event-run');
  const presentation = createLivePresentation();
  let sizesReviewed = false;
  let changing = false;
  let serverSelection: string | null = null;
  let previewFailed = false;
  let active = false;
  let initialized = false;
  let poll: ReturnType<typeof setTimeout> | undefined;

  function render() {
    const s = controller.snapshot(), b = s.bootstrap;
    if (s.trusted && !s.loading) {
      const selected = b?.design?.selectedCandidateRevisionId ?? null;
      if (selected !== serverSelection) comparison.value = selected ? 'candidate' : 'baseline';
      serverSelection = selected;
    }
    const display = presentation.update(s, comparison.value === 'baseline' ? 'baseline' : 'candidate', active);
    const candidate = b?.candidates.find(item => item.revisionId === s.viewedRevisionId);
    const requirements = b?.requirements;
    const currentRun = b?.runs.find(item => item.runId === b.design?.activeRunId)
      ?? b?.runs.filter(item => item.requirementsVersion === requirements?.requirementsVersion).sort((a, z) => a.createdAt.localeCompare(z.createdAt)).at(-1);
    const progress = currentRun?.status === 'queued' ? 'Your request is queued.'
      : currentRun?.status === 'planning' ? 'Astra is planning the handle change.'
        : currentRun?.status === 'running' ? 'Generating geometry and checking the result.' : '';
    const failedRun = currentRun?.status === 'failed' || currentRun?.status === 'cancelled';
    const latest = s.history && [...s.history.acceptances].sort((a, z) => z.stateVersion - a.stateVersion)[0];
    const manifest = latest && s.history?.manifests.find(item => item.acceptanceId === latest.acceptanceId);
    if (length.value !== s.draft.lengthMm) length.value = s.draft.lengthMm;
    if (instruction.value !== s.draft.instruction) instruction.value = s.draft.instruction;
    const handle = requirements?.registryId === 'handle_sample_v1';
    const action = consumerAction(s, { sizesReviewed, changing, canAccept: display.canAccept });
    const step = consumerStep(s, { sizesReviewed, changing });
    Array.from(element('consumer-progress').children).forEach((item, index) => {
      if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    });
    const refining = handle && (changing || requirements.setupId === 'handle_refine_v1');
    const status = s.error ? 'We could not verify this design. Your draft is kept. Check status before continuing.'
      : s.loading ? 'Checking the latest design and files…'
        : s.busy ? 'Sending your action…'
          : !s.trusted ? 'The handle workspace is unavailable. Check status to try again.'
            : !handle ? 'The handle demo is unavailable on this connection. Recorded plate evidence is in the examples.'
              : b?.executionMode === 'fixture' ? 'Test data only. No live handle execution is available.'
                : b?.design?.activeRunId ? progress || 'Creating and checking your design.'
                  : failedRun ? `The handle run ${currentRun!.status}. ${currentRun?.error?.message ?? 'Check status and review before trying again.'}`
                  : s.canDownload ? 'Your accepted design is ready. You can get its files below.'
                    : candidate?.status === 'rejected' ? 'This design did not meet the requirements. Review the failed checks before trying again.'
                      : s.canAccept ? 'Review your design and its checks, then choose whether to use it.'
                        : b?.executionMode !== 'live' ? 'New handle generation is unavailable. Existing verified designs remain inspectable.'
                          : 'Live handle workspace. Start with the sample sizes and describe your change.';
    text('live-status', status);
    text('live-error-detail', s.error ?? (currentRun?.error ? pretty(currentRun.error) : b?.unavailableReason) ?? 'No connection error.');
    text('live-stage', handle ? (refining ? 'Refine your accepted starting design' : 'Create a starting handle') : 'Handle connection unavailable');
    element('live-status').dataset.error = String(Boolean(s.error || failedRun || candidate?.status === 'rejected' || candidate?.status === 'failed'));
    for (const [id, name] of [['live-review-sizes', 'review'], ['live-confirm', 'confirm'], ['live-run', 'run'],
      ['live-accept', 'accept'], ['live-download', 'download']] as const) {
      element<HTMLButtonElement>(id).disabled = action !== name;
      element(id).hidden = action !== name;
    }
    element('live-download').hidden = !s.canDownload;
    element<HTMLButtonElement>('live-download').disabled = !s.canDownload;
    element('live-download').className = action === 'download' ? 'wk-primary' : '';
    element('live-change').hidden = !s.canRefine || changing || !s.canDownload;
    element<HTMLButtonElement>('live-change').disabled = !s.canRefine || s.busy || s.loading || Boolean(s.error);
    element<HTMLButtonElement>('live-sample').disabled = !handle || !s.trusted || s.busy || Boolean(s.pendingAction);
    element('live-size-review').hidden = !sizesReviewed && !s.canRun && !b?.design?.acceptedRevisionId;
    element('live-files').hidden = !s.canDownload || changing;
    for (const [id, enabled] of [['live-retry', Boolean(s.pendingAction) && !s.busy && !s.loading],
      ['live-refresh', !s.busy && !s.loading], ['live-reconnect', !s.busy && !s.loading]] as const) element<HTMLButtonElement>(id).disabled = !enabled;
    element('live-retry').hidden = !s.pendingAction;
    element('live-reconnect').hidden = !s.error || !/event|stream|cursor/i.test(s.error);
    text('live-confirm', refining ? 'Confirm refinement sizes' : 'Confirm starting sizes');
    text('live-run', refining ? 'Create updated design' : 'Create design');
    text('live-run-gate', s.pendingAction ? 'The last request may have arrived. Check status, then retry that same request explicitly.'
      : b?.design?.activeRunId ? progress || 'Checking the current run…'
        : s.canRun ? 'Sizes are confirmed. Creating the design is a separate action.'
          : refining ? 'Keep the mounting pads and finger gap. Broaden the grip and add a thumb rest.'
            : 'The two pads define the mounting positions. They are not an existing handle.');
    text('live-accept-gate', s.canAccept && !display.canAccept ? 'Show Your design and wait for the 3D preview to load before using it.'
      : display.canAccept ? 'Use this design only after reviewing its shape and checks.' : 'A completed run does not accept a design.');
    text('live-export-gate', s.canDownload ? 'These files belong to your accepted design, even while you inspect an earlier design.'
      : 'Files become available after you explicitly use a checked design with the current sizes.');
    if (handle) {
      const brief = requirements.setup.geometry.sampleRequirements;
      text('live-requirements', 'Sample handle sizes');
      text('live-fixed', `Mounting pitch ${brief.mountPitchMm} mm · finger gap at least ${brief.minimumFingerGapMm} mm · length at most ${brief.maximumOverallLengthMm} mm. Concept pads; hardware unspecified.`);
    } else {
      text('live-requirements', 'Handle sizes unavailable');
      text('live-fixed', 'Connect a handle-capable workspace. Unknown sizes have not been filled in.');
    }
    const verifiedCandidate = s.trusted && !s.error && candidate?.executionMode === 'live' ? candidate : null;
    text('live-change-summary', verifiedCandidate?.changeSummary ?? 'No verified design changes yet.');
    const protectedChecks = verifiedCandidate?.checks.filter(item => ['handle.mount_interface', 'handle.grip_clearance'].includes(item.checkId));
    text('live-preserved', protectedChecks?.length === 2 && protectedChecks.every(item => item.state === 'passed')
      ? 'The mounting interface and empty finger gap passed their checks for this design.'
      : 'Mounting and finger-gap preservation have not both passed for this design.');
    text('live-selection', b?.design ? `Selected: ${b.design.selectedCandidateRevisionId ?? 'none'} · state v${b.design.stateVersion}` : 'No current design');
    const run = b?.runs.find(item => item.runId === (b.design?.activeRunId ?? candidate?.runId)) ?? currentRun;
    text('live-run-status', run ? `${run.status}${run.error ? ` · ${run.error.message}` : ''}` : 'No active run');
    revision.replaceChildren(...(b?.candidates.map(item => option(item.revisionId,
      `${item.requirements.registryId === 'handle_sample_v1' ? (item.requirements.setupId === 'handle_initial_v1' ? 'Starting handle' : 'Refined handle') : 'Recorded plate'} · ${item.status} · version ${item.requirementsVersion}${item.revisionId === b.design?.selectedCandidateRevisionId ? ' · current' : ' · earlier'}`)) ?? []));
    if (s.viewedRevisionId) revision.value = s.viewedRevisionId;
    if (!candidate) revision.prepend(option('', 'No candidate selected'));
    revision.disabled = s.loading || !b?.candidates.length;
    text('live-candidate-status', candidate ? `${candidate.revisionId === b?.design?.selectedCandidateRevisionId ? 'Current design' : 'Earlier design'} checks · ${candidate.status}${comparison.value === 'baseline' ? ' · Before is shown for comparison' : ''}${candidate.error ? ` · ${candidate.error.message}` : ''}` : 'No checked design yet. The mounting reference has not been generated or checked as a handle.');
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
        summary.textContent = friendlyChecks[id] ?? check?.label ?? id;
        evidence.textContent = pretty({ checkId: id, measured: check?.measured ?? null, expected: expectedForCheck(r, id), units: check?.units,
          method: check?.method, details: check?.details, diagnostics: check?.diagnostics });
        details.append(summary, evidence); heading.append(details);
        const state = document.createElement('span'); state.className = 'wk-check-state'; state.dataset.state = check?.state ?? 'not_evaluated'; state.textContent = state.dataset.state;
        cell.append(state);
        if (id === 'margin.end_material' && r.registryId === 'plate_requirements_v1') {
          const margin = document.createElement('p'); margin.className = 'wk-margin-evidence';
          const measured = endMaterialMeasurement(check?.measured);
          margin.textContent = measured === null ? 'Measurement unavailable'
            : `${measured} mm measured / ${r.setup.minimumEndMaterialMm} mm minimum`; cell.append(margin);
        }
        if (r.registryId === 'handle_sample_v1') {
          const measured = document.createElement('p'); measured.className = 'wk-measured';
          measured.textContent = measuredSummary(check?.measured); cell.append(measured);
        }
        row.append(heading, cell); return row;
      }) ?? []));
    }
    text('live-evidence', candidate ? pretty({ revisionId: candidate.revisionId, runId: candidate.runId, requirementsId: candidate.requirementsId,
      requirementsVersion: candidate.requirementsVersion, geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash,
      engine: candidate.engine, artifacts: candidate.artifacts, reference: s.reference,
      acceptedInitial: requirements?.registryId === 'handle_sample_v1' ? requirements.setup.acceptedInitial : null }) : 'No candidate evidence');
    text('live-accepted', latest ? `Accepted ${latest.requirements.setupId === 'handle_refine_v1' ? 'updated' : 'starting'} design · ${b?.design?.acceptedRequirementsMatch ? 'current sizes' : 'earlier sizes, confirm and review the new design before downloading'}` : 'No accepted design yet.');
    const previousArtifact = artifact.value;
    artifact.replaceChildren(...(manifest?.artifacts.map(item => option(item.artifactId, `${item.mediaType === 'model/step' ? 'STEP · editable CAD' : item.mediaType === 'model/stl' ? 'STL · 3D mesh' : item.mediaType.includes('python') || item.fileName.endsWith('.py') ? 'Python · editable source' : item.fileName}`)) ?? []));
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
  instruction.addEventListener('input', () => { sizesReviewed = false; controller.setDraft({ instruction: instruction.value }); }, { signal });
  element('live-sample').addEventListener('click', () => {
    const s = controller.snapshot();
    if (!s.trusted || s.bootstrap?.requirements?.registryId !== 'handle_sample_v1' || s.busy || s.pendingAction) return;
    sizesReviewed = false;
    controller.setDraft({ instruction: changing || s.bootstrap.requirements.setupId === 'handle_refine_v1'
      ? 'Broaden the grip and add a localized thumb rest while preserving the accepted starting design, mounting pads and empty finger gap.'
      : 'Create a cabinet handle joining the two mounting pads, with a comfortable grip and the confirmed sample sizes.' });
  }, { signal });
  element('live-review-sizes').addEventListener('click', () => { sizesReviewed = true; render(); }, { signal });
  element('live-change').addEventListener('click', () => {
    if (!controller.snapshot().canRefine) return;
    changing = true; sizesReviewed = false; controller.setDraft({ instruction: '' });
  }, { signal });
  element('live-confirm').addEventListener('click', () => {
    const s = controller.snapshot();
    if (consumerAction(s, { sizesReviewed, changing, canAccept: false }) !== 'confirm') return;
    void controller.confirmRequirements(changing ? 'handle_refine_v1' : undefined);
  }, { signal });
  revision.addEventListener('change', () => { comparison.value = 'candidate'; controller.selectRevision(revision.value); }, { signal });
  comparison.addEventListener('change', render, { signal });
  eventRun.addEventListener('change', render, { signal });
  for (const [id, action] of [['live-run', controller.requestRun],
    ['live-refresh', controller.refresh], ['live-reconnect', controller.reconnect]] as const) {
    element(id).addEventListener('click', () => {
      if (previewFailed && (id === 'live-refresh' || id === 'live-reconnect')) presentation.invalidate();
      void action();
    }, { signal });
  }
  element('live-accept').addEventListener('click', () => {
    if (render().canAccept) void controller.acceptRevision().then(() => { if (controller.snapshot().canDownload) { changing = false; sizesReviewed = false; render(); } });
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
