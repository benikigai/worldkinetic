import { canonicalize } from '../../shared/contracts-v2.js';
import type { LiveWorkspaceController } from './live-state.js';

type Snapshot = ReturnType<LiveWorkspaceController['snapshot']>;
export type LivePresentationUpdate = {
  previewKey: string | null;
  previewAction: 'load' | 'retain' | 'clear';
  evidenceAction: 'replace' | 'retain';
  canAccept: boolean;
};

export function endMaterialMeasurement(measured: unknown): number | null {
  if (!measured || typeof measured !== 'object' || Array.isArray(measured)) return null;
  const evidence = measured as Record<string, unknown>;
  const value = 'measuredValue' in evidence ? evidence.measuredValue : evidence.minimumEndMaterialMm;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createLivePresentation() {
  let identity: string | null = null;
  let previewKey: string | null = null;
  let evidenceKey: string | null = null;
  let evidenceInitialized = false;
  let attempt = 0;
  let state: 'pending' | 'rendered' | 'failed' = 'pending';

  function invalidate() {
    identity = null;
    previewKey = null;
    state = 'pending';
  }

  return {
    update(snapshot: Snapshot, comparison: 'baseline' | 'candidate', active = true): LivePresentationUpdate {
      const { bootstrap, reference } = snapshot;
      const candidate = bootstrap?.candidates.find(item => item.revisionId === snapshot.viewedRevisionId);
      const evidence = candidate ? canonicalize({ revisionId: candidate.revisionId, requirements: candidate.requirements,
        geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash, checks: candidate.checks }) : null;
      const verified = snapshot.trusted && !snapshot.loading && !snapshot.error;
      const nextEvidence = verified ? evidence : snapshot.loading ? evidenceKey : null;
      const evidenceAction = !evidenceInitialized || evidenceKey !== nextEvidence ? 'replace' : 'retain';
      evidenceInitialized = true;
      evidenceKey = nextEvidence;

      const artifact = comparison === 'baseline' ? reference?.artifacts.find(item => item.mediaType === 'model/stl')
        : candidate?.artifacts.find(item => item.mediaType === 'model/stl');
      const nextIdentity = artifact ? canonicalize(comparison === 'baseline'
        ? { comparison, referenceId: reference!.referenceId, revisionId: reference!.revisionId, artifact }
        : { comparison, evidence, artifact, runId: candidate!.runId, executionMode: candidate!.executionMode,
          selectedRevisionId: bootstrap!.design?.selectedCandidateRevisionId ?? null, requirements: bootstrap!.requirements }) : null;

      let previewAction: LivePresentationUpdate['previewAction'] = 'retain';
      // Loading can retain an already verified identity, but cannot introduce new display evidence.
      if (!active || !nextIdentity || (!verified && !(snapshot.loading && identity === nextIdentity && previewKey))) {
        invalidate();
        previewAction = 'clear';
      } else if (nextIdentity !== identity) {
        identity = nextIdentity;
        // A fresh attempt token prevents callbacks from an earlier visit blessing this same identity.
        previewKey = `${++attempt}:${identity}`;
        state = 'pending';
        previewAction = 'load';
      }

      // The controller verifies authoritative evidence; this gate adds exact displayed identity and render success.
      const canAccept = Boolean(active && verified && !snapshot.loading && snapshot.canAccept
        && comparison === 'candidate' && candidate?.executionMode === 'live'
        && candidate.revisionId === bootstrap?.design?.selectedCandidateRevisionId
        && identity === nextIdentity && previewKey && state === 'rendered');
      return { previewKey, previewAction, evidenceAction, canAccept };
    },
    rendered(key: string | null) { if (key && key === previewKey && state === 'pending') state = 'rendered'; },
    failed(key: string | null) { if (key && key === previewKey) state = 'failed'; },
    invalidate,
  };
}
