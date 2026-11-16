import type {
  ChangeRequestReviewerState,
  ReviewerStateValue,
  SourceControlIdentity,
  SourceControlUser,
} from '@openchamber/ui/lib/api/types';

interface UserWire {
  id: string | number;
  provider?: string;
  instance?: string;
  username?: string;
  login?: string;
  avatarUrl?: string;
  name?: string;
  email?: string;
}

type ParseUser = (user: UserWire, identity: SourceControlIdentity) => SourceControlUser;

const REVIEWER_STATES: readonly ReviewerStateValue[] = ['pending', 'approved', 'changes_requested', 'commented', 'dismissed'];

export const parseReviewerStates = (
  entries: ChangeRequestReviewerState[],
  identity: SourceControlIdentity,
  parseUser: ParseUser,
): ChangeRequestReviewerState[] => {
  if (!Array.isArray(entries)) throw new Error('Source control response contained invalid reviewer states');
  return entries.map((entry) => {
    const state = REVIEWER_STATES.find((candidate) => candidate === entry?.state);
    if (!entry || !state) throw new Error('Source control response contained an invalid reviewer state');
    return { user: parseUser(entry.user, identity), state };
  });
};
