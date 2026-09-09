import { PackageRfqSchema } from '../../shared/package-v2.js';
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
  let checkedRevision: string | null = null;
  let makingRevision: string | null = null;
  let packageBusy = false;
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
    const failedRun = !s.canAccept && (currentRun?.status === 'failed' || currentRun?.status === 'cancelled');
    const latest = s.history && [...s.history.acceptances].sort((a, z) => z.stateVersion - a.stateVersion)[0];
    const manifest = latest && s.history?.manifests.find(item => item.acceptanceId === latest.acceptanceId);
    if (length.value !== s.draft.lengthMm) length.value = s.draft.lengthMm;
    if (instruction.value !== s.draft.instruction) instruction.value = s.draft.instruction;
    const handle = requirements?.registryId === 'handle_sample_v1';
    // Recovery can reconcile a committed final acceptance without revisiting the accept callback.
    if (handle && requirements.setupId === 'handle_refine_v1' && s.canDownload) {
      changing = false; sizesReviewed = false;
    }
    const action = consumerAction(s, { sizesReviewed, changing, canAccept: display.canAccept });
    const step = consumerStep(s, { sizesReviewed, changing });
    Array.from(element('consumer-progress').children).forEach((item, index) => {
      if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    });
    const refining = handle && (changing || requirements.setupId === 'handle_refine_v1');
    const filesReady = (s.canDownload || packageBusy) && !changing && s.trusted && !s.error;
    const acceptedForMaking = b?.design?.acceptedRevisionId ?? null;
    if (acceptedForMaking !== makingRevision) {
      for (const id of ['make-quantity', 'make-material', 'make-finish', 'make-destination', 'make-needed-by', 'make-fit-notes']) element<HTMLInputElement>(id).value = '';
      for (const id of ['make-check-size', 'make-check-gap', 'make-check-review']) element<HTMLInputElement>(id).checked = false;
      makingRevision = acceptedForMaking;
    }
    element<HTMLButtonElement>('make-package').disabled = !s.canDownload || packageBusy;
    const reviewing = s.canAccept;
    element('live-inputs').hidden = filesReady || reviewing;
    element('live-review-request').hidden = !reviewing;
    text('live-review-guidance', refining ? 'Check the shape and sizes, then approve this design to get its files.' : 'Check the shape and sizes, then approve this design. To refine it, choose Make another change after approval.');
    const reviewedRun = b?.runs.find(item => item.runId === candidate?.runId);
    text('live-reviewed-idea', reviewedRun?.instruction ?? 'Request unavailable for this design.');
    text('live-title', filesReady ? 'Your design is ready' : reviewing ? 'Review your design' : 'What would you like to change?');
    const status = s.error ? 'The demo is offline. Your draft is safe. Try Check status.'
      : s.loading ? 'Checking your design…'
        : s.busy ? 'Saving…'
          : !s.trusted || !handle ? 'The handle demo is unavailable. Try Check status.'
            : b?.executionMode === 'fixture' ? 'Test data only. Live design is unavailable.'
              : b?.design?.activeRunId ? progress || 'Creating your design…'
                : failedRun ? currentRun?.error?.code === 'RUN_TIMEOUT'
                  ? b?.design?.acceptedRevisionId ? 'This request timed out. Your approved design is unchanged.' : 'This request timed out. No new design was approved.'
                  : currentRun?.error?.code === 'EXPORT_FAILED'
                  ? 'Astra created a design, but its 3D export did not pass the checks. No new design was approved.'
                  : 'This request could not be completed. No new design was approved.'
                  : filesReady ? 'Approved and ready to download.'
                    : candidate?.status === 'rejected' ? 'Some checks failed. Review them below.'
                      : s.canAccept ? 'Check the shape and sizes, then approve the design.'
                        : b?.executionMode !== 'live' ? 'New designs are unavailable. You can view saved results.'
                          : 'Describe your idea or use Sample prompt.';
    text('live-status', status);
    text('live-error-detail', s.error ?? (currentRun?.error ? pretty(currentRun.error) : b?.unavailableReason) ?? 'No connection error.');
    text('live-stage', filesReady ? 'Approved' : !handle ? 'Unavailable' : b?.design?.activeRunId ? 'Creating' : s.canAccept ? 'Review' : refining ? 'Refine' : 'Start');
    element('live-status').dataset.error = String(Boolean(s.error || failedRun || candidate?.status === 'rejected' || candidate?.status === 'failed'));
    for (const [id, name] of [['live-review-sizes', 'review'], ['live-confirm', 'confirm'], ['live-run', 'run'],
      ['live-accept', 'accept'], ['live-download', 'download']] as const) {
      element<HTMLButtonElement>(id).disabled = action !== name;
      element(id).hidden = action !== name;
    }
    element('live-review-sizes').hidden = reviewing || action === 'confirm';
    text('live-review-sizes', b?.design?.activeRunId ? 'Creating your design…' : action === 'run' ? refining ? 'Create updated design' : 'Create design' : 'Submit idea');
    element<HTMLButtonElement>('live-review-sizes').disabled = action !== 'review' && action !== 'run';
    element('live-run').hidden = true;
    instruction.disabled = Boolean(reviewing || s.busy || s.pendingAction || b?.design?.activeRunId);
    const showRunProgress = Boolean(b?.design?.activeRunId) || (!changing && currentRun?.instruction === s.draft.instruction && action !== 'review' && action !== 'confirm');
    const submitted = showRunProgress ? currentRun?.instruction : undefined;
    element('live-submitted').hidden = !submitted;
    text('live-submitted', submitted ? `Submitted idea: ${submitted}` : '');
    element('live-attempt').hidden = !showRunProgress || !currentRun?.attemptIds.length;
    text('live-attempt', currentRun?.attemptIds.length ? `Attempt ${currentRun.attemptIds.length} · ${currentRun.status === 'running' ? 'Building geometry and checking exports' : currentRun.status === 'planning' ? 'Sent to Astra' : currentRun.status === 'completed' ? 'Finished. Review the checks before approving.' : currentRun.status === 'failed' ? b?.design?.acceptedRevisionId ? 'Failed. Your approved design is unchanged.' : 'Could not finish this design. No new design was approved.' : currentRun.status === 'cancelled' ? 'Request canceled.' : currentRun.status === 'superseded' ? 'Replaced by a newer request.' : 'Request queued.'}` : '');
    element('live-download').hidden = !s.canDownload;
    element<HTMLButtonElement>('live-download').disabled = !s.canDownload;
    element('live-download').className = '';
    element('live-change').hidden = !s.canRefine || changing || !s.canDownload;
    element<HTMLButtonElement>('live-change').disabled = !s.canRefine || s.busy || s.loading || Boolean(s.error);
    element<HTMLButtonElement>('live-sample').disabled = !handle || !s.trusted || s.busy || s.loading || Boolean(s.error || s.pendingAction || b?.design?.activeRunId);
    element('live-size-review').hidden = filesReady || (!sizesReviewed && !s.canRun);
    if (b?.design?.activeRunId || s.canAccept || filesReady) element<HTMLDetailsElement>('live-size-review').open = false;
    element('live-files').hidden = !filesReady;
    for (const [id, enabled] of [['live-retry', Boolean(s.pendingAction) && !s.busy && !s.loading],
      ['live-refresh', !s.busy && !s.loading], ['live-reconnect', !s.busy && !s.loading]] as const) element<HTMLButtonElement>(id).disabled = !enabled;
    element('live-retry').hidden = !s.pendingAction;
    element('live-refresh').hidden = filesReady && !s.error;
    element('live-reconnect').hidden = !s.error || !/event|stream|cursor/i.test(s.error);
    if (action === 'confirm') text('live-status', 'Waiting for you: check the sizes below, then select Confirm sizes. Astra has not started yet.');
    if (action === 'run' && !failedRun) text('live-status', 'Ready to start. Select Create design to send your idea to Astra.');
    text('live-confirm', 'Confirm sizes');
    text('live-run', refining ? 'Create updated design' : 'Create design');
    text('live-run-gate', s.pendingAction ? 'Check status before retrying the last request.'
      : !filesReady && !s.draft.instruction.trim() && !b?.design?.activeRunId && !s.canAccept ? 'Enter your idea, then select Submit idea.' : '');
    text('live-accept-gate', s.canAccept && !display.canAccept ? 'Show Your design and wait for it to load.' : '');
    text('live-export-gate', s.canDownload ? 'These files belong to your accepted design, even while you inspect an earlier design.'
      : 'Approve a checked design to get its files.');
    if (handle) {
      const brief = requirements.setup.geometry.sampleRequirements;
      text('live-requirements', 'Sample brief');
      text('live-fixed', `Mount spacing: ${brief.mountPitchMm} mm. Finger gap: at least ${brief.minimumFingerGapMm} mm. Maximum length: ${brief.maximumOverallLengthMm} mm. Hardware unspecified.`);
    } else {
      text('live-requirements', 'Handle sizes unavailable');
      text('live-fixed', 'Connect a handle-capable workspace. Unknown sizes have not been filled in.');
    }
    const verifiedCandidate = s.trusted && !s.error && candidate?.executionMode === 'live' ? candidate : null;
    element('live-results').hidden = !active || !verifiedCandidate;
    element('live-earlier-designs').hidden = !active || !s.trusted || Boolean(s.error) || (b?.candidates.length ?? 0) < 2;
    const noPreview = active && (!display.previewKey || previewFailed);
    element('live-view-actions').hidden = noPreview;
    element('model-measurements').hidden = noPreview;
    element('navigation-help').hidden = noPreview;
    text('live-change-summary', verifiedCandidate?.changeSummary ?? 'No verified design changes yet.');
    const protectedChecks = verifiedCandidate?.checks.filter(item => ['handle.mount_interface', 'handle.grip_clearance'].includes(item.checkId));
    text('live-preserved', protectedChecks?.length === 2 && protectedChecks.every(item => item.state === 'passed')
      ? 'Mounts and finger space passed their checks.'
      : 'Mounts and finger space are not yet verified.');
    text('live-selection', b?.design ? `Selected: ${b.design.selectedCandidateRevisionId ?? 'none'} · state v${b.design.stateVersion}` : 'No current design');
    const run = b?.runs.find(item => item.runId === (b.design?.activeRunId ?? candidate?.runId)) ?? currentRun;
    text('live-run-status', run ? `${run.status}${run.error ? ` · ${run.error.message}` : ''}` : 'No active run');
    revision.replaceChildren(...(b?.candidates.map(item => option(item.revisionId,
      `${item.requirements.registryId === 'handle_sample_v1' ? (item.requirements.setupId === 'handle_initial_v1' ? 'Starting handle' : 'Refined handle') : 'Recorded plate'} · ${item.status} · version ${item.requirementsVersion}${item.revisionId === b.design?.selectedCandidateRevisionId ? ' · current' : ' · earlier'}`)) ?? []));
    if (s.viewedRevisionId) revision.value = s.viewedRevisionId;
    if (!candidate) revision.prepend(option('', 'No candidate selected'));
    revision.disabled = s.loading || !b?.candidates.length;
    text('live-candidate-status', candidate ? `${candidate.revisionId === b?.design?.acceptedRevisionId ? 'Approved design' : candidate.status === 'reviewable' ? 'Ready to review' : candidate.status === 'rejected' ? 'Needs changes' : candidate.status}${candidate.revisionId !== b?.design?.selectedCandidateRevisionId ? ' · earlier design' : ''}${comparison.value === 'baseline' ? ' · comparing with Before' : ''}` : 'No design to review yet.');
    if (s.trusted && !s.loading && candidate && checkedRevision !== candidate.revisionId) {
      element<HTMLDetailsElement>('live-check-details').open = candidate.status === 'rejected' || candidate.status === 'failed';
      checkedRevision = candidate.revisionId;
    }
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
          measured.textContent = measuredSummary(check?.measured); details.append(measured);
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
    else if (manifest?.artifacts.some(item => item.mediaType === 'model/step')) artifact.value = manifest.artifacts.find(item => item.mediaType === 'model/step')!.artifactId;
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
  function submitIdea() {
    const action = consumerAction(controller.snapshot(), { sizesReviewed, changing, canAccept: false });
    if (action === 'review') { sizesReviewed = true; element<HTMLDetailsElement>('live-size-review').open = true; render(); }
    else if (action === 'run') void controller.requestRun();
  }
  element('live-review-sizes').addEventListener('click', submitIdea, { signal });
  instruction.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat) submitIdea();
  }, { signal });
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
  element('make-package').addEventListener('click', () => {
    if (!controller.snapshot().canDownload || packageBusy) return;
    void (async () => {
      const value = (id: string) => element<HTMLInputElement>(id).value.trim() || null;
      const quantity = value('make-quantity');
      const preferences = PackageRfqSchema.safeParse({ quantity: quantity === null ? null : Number(quantity),
        material: value('make-material'), finish: value('make-finish'), destination: value('make-destination'), neededBy: value('make-needed-by') });
      if (!preferences.success) { text('make-package-status', 'Check your quote details. Use a whole quantity from 1 to 1,000,000, short single-line preferences and a valid date, or leave fields blank.'); return; }
      packageBusy = true; text('make-package-status', 'Preparing and verifying your accepted design package…'); render();
      let url: string | undefined;
      try {
        const result = await controller.downloadPackage(preferences.data);
        if (!result || !controller.canSavePackage(result)) throw new Error('The accepted design could not be confirmed. Check status and try again.');
        url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/zip' }));
        const link = document.createElement('a'); link.href = url; link.download = result.fileName;
        document.body.append(link); link.click(); link.remove();
        text('make-package-status', 'Verified package downloaded. Open it, then choose what to share with a supplier.');
      } catch (failure) { text('make-package-status', failure instanceof Error ? failure.message : 'Package unavailable. No file was downloaded.'); }
      finally { packageBusy = false; render(); if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000); } }
    })();
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
