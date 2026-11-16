import type { SourceControlUser } from './types';

export interface ChangeRequestVerdict {
  state: 'approved' | 'changes_requested';
  author?: SourceControlUser;
  createdAt: string | null;
  url: string;
}

export type ReviewerStateValue = 'pending' | 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface ChangeRequestReviewerState {
  user: SourceControlUser;
  state: ReviewerStateValue;
}
