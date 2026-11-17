import type { SourceControlChangeRequestContext, SourceControlReviewerState } from '@openchamber/sdk';

export type GiteaPerson = { id: number; login: string; avatar_url?: string };

export type GiteaReview = {
  user?: GiteaPerson;
  state: string;
  stale?: boolean;
};

const STATE = new Map<string, SourceControlReviewerState['state']>([
  ['APPROVED', 'approved'],
  ['REQUEST_CHANGES', 'changes_requested'],
  ['COMMENT', 'commented'],
  ['PENDING', 'pending'],
]);

const stateOf = (state: string): SourceControlReviewerState['state'] | null => STATE.get(state) ?? null;

const person = (user: GiteaPerson): SourceControlReviewerState['user'] => {
  const mapped: SourceControlReviewerState['user'] = { id: String(user.id), username: user.login };
  if (user.avatar_url) mapped.avatarUrl = user.avatar_url;
  return mapped;
};

export type ReviewerStatesApi = {
  withReviewerStates: <T extends object>(context: T, reviews: GiteaReview[] | null, requested: GiteaPerson[]) => T & SourceControlChangeRequestContext;
};

export const withReviewerStates = <T extends object>(
  context: T,
  reviews: GiteaReview[] | null,
  requested: GiteaPerson[],
): T & SourceControlChangeRequestContext => {
  if (!reviews) return context;
  const latest = new Map<string, SourceControlReviewerState>();
  for (const review of reviews) {
    const state = stateOf(review.state);
    if (review.user && state) latest.set(String(review.user.id), { user: person(review.user), state });
  }
  for (const user of requested) {
    if (!latest.has(String(user.id))) latest.set(String(user.id), { user: person(user), state: 'pending' });
  }
  return latest.size === 0 ? context : { ...context, reviewerStates: [...latest.values()] };
};
