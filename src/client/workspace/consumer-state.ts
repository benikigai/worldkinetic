import type { LiveWorkspaceController } from './live-state.js';

type Snapshot = ReturnType<LiveWorkspaceController['snapshot']>;
export type ConsumerAction = 'review' | 'confirm' | 'run' | 'accept' | 'download' | null;

export function consumerAction(s: Snapshot, local: { sizesReviewed: boolean; canAccept: boolean; changing: boolean }): ConsumerAction {
  if (!s.trusted || s.loading || s.busy || s.error || s.pendingAction
    || s.bootstrap?.requirements?.registryId !== 'handle_sample_v1' || s.bootstrap.executionMode === 'fixture') return null;
  if (s.canAccept) return local.canAccept ? 'accept' : null;
  if (s.canDownload && !local.changing) return 'download';
  if (s.canRun) return 'run';
  if (!s.draft.instruction.trim() || (!s.canConfirm && !(local.changing && s.canRefine))) return null;
  return local.sizesReviewed ? 'confirm' : 'review';
}

export function consumerStep(s: Snapshot, local: { sizesReviewed: boolean; changing: boolean }): number | null {
  if (!s.trusted || s.loading || s.error || s.bootstrap?.requirements?.registryId !== 'handle_sample_v1'
    || s.bootstrap.executionMode === 'fixture') return null;
  if (s.canDownload && !local.changing) return 3;
  if (s.bootstrap.design?.activeRunId || s.canAccept || s.bootstrap.design?.selectedCandidateRevisionId && !local.changing) return 2;
  if (local.sizesReviewed || s.canRun) return 1;
  return 0;
}
