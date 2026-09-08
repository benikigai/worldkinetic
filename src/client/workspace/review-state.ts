import {
  BootstrapSchema, EventSchema, verifyRequirements, verifyCandidateEvidence,
  type Bootstrap, type Candidate, type Check, type Event, type Requirements,
} from '../../shared/contracts-v2.js';

export const API_HANDOFF_REASON = 'This fixture-review UI has not connected live actions or verified acceptance and export manifest transport yet.';

export interface ReviewSnapshot {
  bootstrap: Bootstrap | null;
  viewedRevisionId: string | null;
  activity: Event[];
  loading: boolean;
  error: string | null;
  refreshRequired: boolean;
}

export async function verifyBootstrap(raw: unknown): Promise<Bootstrap> {
  const bootstrap = BootstrapSchema.parse(raw);
  if (bootstrap.requirements) await verifyRequirements(bootstrap.requirements);
  await Promise.all(bootstrap.candidates.map(candidate => verifyCandidateEvidence(candidate)));
  return bootstrap;
}

const bindingKeys = ['designId', 'requirementsId', 'requirementsVersion', 'registryId', 'registryHash',
  'setupId', 'setupHash', 'referenceHash', 'validatorVersion'] as const;

function matchesRequirements(value: Pick<Candidate, typeof bindingKeys[number]>, requirements: Requirements) {
  return bindingKeys.every(key => value[key] === requirements[key]);
}

export function createReviewController() {
  let state: ReviewSnapshot = {
    bootstrap: null, viewedRevisionId: null, activity: [], loading: false, error: null, refreshRequired: false,
  };
  let generation = 0;
  let eventWatermark = 0;
  let stateWatermark = 0;

  function fail(message: string) {
    generation++;
    state = { bootstrap: null, viewedRevisionId: null, activity: [], loading: false, error: message, refreshRequired: false };
  }

  return {
    snapshot(): ReviewSnapshot { return structuredClone(state); },
    async loadBootstrap(raw: unknown | Promise<unknown>): Promise<void> {
      const token = ++generation;
      eventWatermark = 0;
      stateWatermark = 0;
      state = { bootstrap: null, viewedRevisionId: null, activity: [], loading: true, error: null, refreshRequired: false };
      try {
        const input = await raw;
        if (token !== generation) return;
        const bootstrap = await verifyBootstrap(input);
        // Verification can finish after a newer selection or refresh has begun.
        if (token !== generation) return;
        stateWatermark = bootstrap.design?.stateVersion ?? 0;
        state = { bootstrap, viewedRevisionId: bootstrap.design?.selectedCandidateRevisionId ?? null,
          activity: [], loading: false, error: null, refreshRequired: false };
      } catch {
        if (token === generation) fail('Review data unavailable. The response could not be loaded or its v0.2 schema and evidence hashes could not be verified. Choose a fixture explicitly to recover.');
      }
    },
    selectRevision(revisionId: string): void {
      if (!state.loading && !state.error && state.bootstrap?.candidates.some(candidate => candidate.revisionId === revisionId)) {
        state = { ...state, viewedRevisionId: revisionId };
      }
    },
    async receiveEvent(raw: unknown): Promise<void> {
      const token = generation;
      const bootstrap = state.bootstrap;
      if (!bootstrap?.design || !bootstrap.requirements || state.loading || state.error) return;
      const { design, requirements } = bootstrap;
      try {
        const event = EventSchema.parse(raw);
        const relevant = () => event.designId === design.designId
          && event.requirementsVersion === requirements.requirementsVersion
          && event.executionMode === bootstrap.executionMode
          && event.stateVersion >= stateWatermark && event.eventId > eventWatermark;
        if (!relevant()) return;
        if (event.run && !matchesRequirements(event.run, requirements)) return;
        if (event.candidate && !matchesRequirements(event.candidate, requirements)) return;
        if (event.candidate) await verifyCandidateEvidence(event.candidate);
        if (token !== generation || !relevant()) return;
        eventWatermark = event.eventId;
        stateWatermark = event.stateVersion;
        // Events are observations. Only a fresh bootstrap may replace server state.
        state = { ...state, activity: [...state.activity, event], refreshRequired: true };
      } catch {
        if (token === generation) fail('Review data unavailable. An event failed v0.2 schema or evidence hash verification. Reload a fixture explicitly to recover.');
      }
    },
  };
}

export function reviewProjection(snapshot: ReviewSnapshot) {
  const { bootstrap } = snapshot;
  const candidate = bootstrap?.candidates.find(value => value.revisionId === snapshot.viewedRevisionId) ?? null;
  const requirements = candidate?.requirements ?? bootstrap?.requirements;
  const rows = (requirements?.requiredChecks ?? []).map(checkId => {
    const check: Check | null = candidate?.checks.find(value => value.checkId === checkId) ?? null;
    return { checkId, state: check?.state ?? 'not_evaluated' as const, check };
  });
  const isHistorical = candidate !== null && (candidate.revisionId !== bootstrap?.design?.selectedCandidateRevisionId
    || !bootstrap?.requirements || !matchesRequirements(candidate, bootstrap.requirements));
  const blockingReasons = [API_HANDOFF_REASON];
  if (snapshot.loading) blockingReasons.push('Evidence verification is in progress.');
  if (snapshot.error || !bootstrap) blockingReasons.push('Verified review data is unavailable.');
  if (bootstrap?.executionMode === 'fixture' || candidate?.executionMode === 'fixture') {
    blockingReasons.push('Synthetic fixture evidence is never eligible for live acceptance or download.');
  }
  if (bootstrap?.executionMode === 'unavailable' || candidate?.executionMode === 'unavailable') blockingReasons.push('Execution evidence is unavailable.');
  if (!candidate) blockingReasons.push('No candidate revision is available.');
  if (isHistorical) blockingReasons.push('This is local historical inspection, outside the current server selection or requirements binding.');
  if (candidate && candidate.status !== 'reviewable') blockingReasons.push(`Candidate status is ${candidate.status}.`);
  if (rows.some(row => row.state !== 'passed')) blockingReasons.push('Every required check must pass; failed and not_evaluated checks block acceptance.');
  if (snapshot.refreshRequired) blockingReasons.push('An event requests an authoritative bootstrap refresh.');
  if (!bootstrap?.design?.acceptedRevisionId) blockingReasons.push('No accepted revision.');
  return { candidate, rows, isHistorical, canAccept: false, canDownload: false, blockingReasons };
}
