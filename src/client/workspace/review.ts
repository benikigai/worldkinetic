import { checkDefinition, expectedForCheck } from '../../shared/contracts-v2.js';
import { createReviewController, reviewProjection } from './review-state.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const json = (value: unknown) => escape(JSON.stringify(value, null, 2));
const code = (label: string, value: string | null) => `<dt>${escape(label)}</dt><dd><code>${escape(value ?? 'Unavailable')}</code></dd>`;

export function mountReview(fixtures: { history: unknown; feature: unknown; event: unknown }, signal: AbortSignal) {
  const controller = createReviewController();
  const scenario = element<HTMLSelectElement>('review-scenario');
  const revision = element<HTMLSelectElement>('review-revision');
  const eventButton = element<HTMLButtonElement>('review-event');
  let initialized = false;

  function render() {
    const snapshot = controller.snapshot();
    const projection = reviewProjection(snapshot);
    const { bootstrap, error, loading } = snapshot;
    const { candidate, rows } = projection;
    const requirements = candidate?.requirements ?? bootstrap?.requirements;
    element('review-status').textContent = loading ? 'Verifying fixture schema and SHA-256 evidence...'
      : error ?? (bootstrap?.requirements ? `Synthetic evidence loaded. ${bootstrap.candidates.some(item => item.checkBundleHash !== null)
        ? 'Requirements and supplied check-bundle hashes verified'
        : bootstrap.candidates.length ? 'Requirements hash verified; no check bundle supplied'
          : 'Requirements hash verified; no candidate or check bundle supplied'}; geometry and physical fit are unverified.` : 'Review data unavailable.');
    element('review-status').dataset.error = String(Boolean(error));
    element('review-content').hidden = !bootstrap || loading || Boolean(error);
    element('review-blockers').replaceChildren(...projection.blockingReasons.map(reason => {
      const item = document.createElement('li'); item.textContent = reason; return item;
    }));
    revision.disabled = !bootstrap?.candidates.length || loading;
    eventButton.disabled = !bootstrap || scenario.value !== 'history' || loading;
    if (!bootstrap || !bootstrap.requirements || !bootstrap.design || !requirements) {
      revision.replaceChildren();
      element('review-checks').replaceChildren();
      element('review-evidence').replaceChildren();
      element('review-activity').replaceChildren();
      return;
    }

    const active = bootstrap.requirements;
    element('review-requirement').textContent = active.registryId === 'plate_requirements_v1'
      ? `${active.setup.dimensions.lengthMm} mm length · v${active.requirementsVersion}` : `Requirements v${active.requirementsVersion}`;
    element('review-minimum').textContent = active.registryId === 'plate_requirements_v1'
      ? `${active.setup.minimumEndMaterialMm} mm minimum end material · frozen` : 'End material summary unavailable for this setup.';
    element('review-server-selection').textContent = `Selected: ${bootstrap.design.selectedCandidateRevisionId ?? 'No candidate'}`;
    element('review-accepted').textContent = bootstrap.design.acceptedRevisionId
      ? `Accepted: ${bootstrap.design.acceptedRevisionId}` : 'No accepted revision';
    revision.replaceChildren(...bootstrap.candidates.map(item => {
      const option = document.createElement('option');
      option.value = item.revisionId;
      const selected = item.revisionId === bootstrap.design?.selectedCandidateRevisionId;
      const label = item.requirements.registryId === 'plate_requirements_v1'
        ? `${item.requirements.setup.dimensions.lengthMm} mm` : 'Candidate';
      option.textContent = `${label} · ${item.status} · v${item.requirementsVersion} · ${selected ? 'server-selected' : 'history'}`;
      return option;
    }));
    if (snapshot.viewedRevisionId) revision.value = snapshot.viewedRevisionId;
    if (!candidate) {
      const option = document.createElement('option'); option.textContent = 'No candidate supplied'; revision.append(option);
    }
    element('review-binding').textContent = candidate
      ? `${projection.isHistorical ? 'Local historical inspection' : 'Inspecting server-selected candidate'} · ${candidate.executionMode} evidence · requirements v${candidate.requirementsVersion}. Server state is unchanged.`
      : requirements.registryId === 'plate_requirements_v1'
        ? 'Feature requirements only. No candidate or measured geometry is supplied.'
        : 'Requirements only. No candidate or measured geometry is supplied.';
    const candidateLength = candidate?.requirements.registryId === 'plate_requirements_v1'
      ? ` · ${candidate.requirements.setup.dimensions.lengthMm} mm length` : '';
    element('review-candidate').textContent = candidate
      ? `${candidate.revisionId} · ${candidate.status}${candidateLength}` : 'Candidate revision: unavailable';
    element('review-check-count').textContent = `${rows.filter(row => row.state === 'passed').length}/${rows.length} passed`;
    element('review-checks').innerHTML = rows.map(({ checkId, state, check }) => {
      const definition = checkDefinition(checkId, requirements.registryId);
      const margin = requirements.registryId === 'plate_requirements_v1' && checkId === 'margin.end_material' && check?.measured && typeof check.measured === 'object' && !Array.isArray(check.measured)
        ? `<p class="wk-margin-evidence">${escape(String(check.measured.minimumEndMaterialMm))} mm measured / ${requirements.setup.minimumEndMaterialMm} mm minimum</p>` : '';
      return `<tr><th scope="row"><details><summary>${escape(check?.label ?? checkId)}<span class="wk-check-id">${escape(checkId)}</span></summary>${margin}
        <dl class="wk-check-detail"><dt>Measured / synthetic</dt><dd><pre>${check ? json(check.measured) : 'Unavailable. This check has not been evaluated.'}</pre></dd>
        <dt>Expected / frozen requirements v${requirements.requirementsVersion}</dt><dd><pre>${json(check?.expected ?? expectedForCheck(requirements, checkId))}</pre></dd>
        <dt>Units</dt><dd>${escape((check?.units ?? definition.units).join(', '))}</dd>
        <dt>Method</dt><dd>${escape(check?.method ?? definition.method)}</dd>
        ${check ? `<dt>Evidence note</dt><dd>${escape(check.details)}</dd>` : ''}
        ${check?.diagnostics ? `<dt>Synthetic diagnostics</dt><dd><pre>${json(check.diagnostics)}</pre></dd>` : ''}</dl></details></th>
        <td><span class="wk-check-state" data-state="${state}">${state}</span>${margin}</td></tr>`;
    }).join('');

    const identity = code('Requirements ID', requirements.requirementsId) + code('Setup SHA-256', requirements.setupHash)
      + code('Registry SHA-256', requirements.registryHash) + code('Reference SHA-256', requirements.referenceHash)
      + code('Validator', requirements.validatorVersion);
    element('review-evidence').innerHTML = `<p>Hash verification establishes fixture record consistency. Artifact bytes are not fetched or verified here; descriptors do not register a download.</p><dl>${identity}
      ${candidate ? code('Revision', candidate.revisionId) + code('Run / synthetic', candidate.runId)
        + code('Check-bundle SHA-256 / verified', candidate.checkBundleHash) + code('STEP SHA-256 / descriptor', candidate.geometryHash)
        + code('Source SHA-256 / descriptor', candidate.sourceSha256) : ''}</dl>
      ${candidate ? candidate.artifacts.map(artifact => `<details><summary>${escape(artifact.fileName)} · ${escape(artifact.kind)} · fixture descriptor</summary><dl>
        ${code('Artifact ID', artifact.artifactId)}${code('Revision', artifact.revisionId)}${code('Run', artifact.runId)}${code('Design', artifact.designId)}
        ${code('Requirements', `${artifact.requirementsId} / v${artifact.requirementsVersion}`)}${code('Media type', artifact.mediaType)}
        ${code('Declared bytes', String(artifact.bytes))}${code('SHA-256', artifact.sha256)}${code('Public href / unregistered', artifact.href)}
        </dl></details>`).join('') : '<p>No candidate artifacts are supplied.</p>'}`;
    element('review-refresh').textContent = snapshot.refreshRequired
      ? 'Refresh required: the event did not update server state. Reload selected fixture to re-read the authoritative snapshot; no live bootstrap is connected.'
      : 'No event sample replayed for this load.';
    element('review-activity').replaceChildren(...snapshot.activity.map(event => {
      const item = document.createElement('li');
      item.textContent = `Synthetic event sample #${event.eventId}: ${event.type} · ${event.revisionId ?? 'no revision'} · requirements v${event.requirementsVersion} · state v${event.stateVersion} · ${event.createdAt}. Observation only.`;
      return item;
    }));
  }

  async function load() {
    initialized = true;
    const data = scenario.value === 'feature' ? fixtures.feature : fixtures.history;
    const pending = controller.loadBootstrap(scenario.value === 'unavailable'
      ? Promise.reject(new Error('Explicit unavailable fixture scenario.')) : data);
    render();
    await pending;
    render();
  }

  scenario.addEventListener('change', () => { void load(); }, { signal });
  element('review-reload').addEventListener('click', () => { void load(); }, { signal });
  revision.addEventListener('change', () => { controller.selectRevision(revision.value); render(); }, { signal });
  eventButton.addEventListener('click', async () => {
    eventButton.disabled = true;
    await controller.receiveEvent(fixtures.event);
    render();
  }, { signal });
  render();
  return { open() { if (!initialized) void load(); } };
}
