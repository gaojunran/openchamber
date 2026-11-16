import { describe, expect, it } from 'vitest';

import type { SourceControlReadContext } from '@openchamber/ui/lib/api/types';
import { fetchRepositoryReferenceDetail } from './repository-references';

const identity = { provider: 'github' as const, instance: 'github.com' };
const context: SourceControlReadContext = {
  ...identity,
  directory: '/repo',
  repositoryId: 'repo-1',
  accountId: 'github.com#1',
  bindingRevision: 1,
  primaryRemote: 'origin',
};

type WireReviewer = { id: string; login: string; state: string; avatarUrl?: string };
type WirePull = {
  reviewDecision: null;
  reviewers: { id: string; login: string; avatarUrl?: string }[];
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewerStates?: WireReviewer[];
};

const pull = (reviewerStates?: WireReviewer[]): WirePull => {
  const detail: WirePull = { reviewDecision: null, reviewers: [], additions: 0, deletions: 0, changedFiles: 0 };
  if (reviewerStates !== undefined) detail.reviewerStates = reviewerStates;
  return detail;
};
const answer = (pullDetail: WirePull) => ({
  connected: true,
  detail: { number: 9, comments: [], commentTotal: 0, pull: pullDetail },
});
const read = (payload: ReturnType<typeof answer>) => fetchRepositoryReferenceDetail(
  async () => Response.json(payload),
  context,
  { owner: 'acme', repo: 'app', number: 9 },
);

describe('repository reference detail parsing', () => {
  it('keeps per-person reviewer state through the wire schema', async () => {
    const result = await read(answer(pull([
      { id: '9', login: 'ann', avatarUrl: 'https://avatars/ann', state: 'approved' },
      { id: '10', login: 'bo', state: 'pending' },
    ])));
    if (!result.connected || !result.detail?.pull) throw new Error('expected a pull detail');
    expect(result.detail.pull.reviewerStates).toEqual([
      { id: '9', login: 'ann', avatarUrl: 'https://avatars/ann', state: 'approved' },
      { id: '10', login: 'bo', state: 'pending' },
    ]);
  });

  it('leaves an absent field absent rather than empty', async () => {
    const result = await read(answer(pull()));
    if (!result.connected || !result.detail?.pull) throw new Error('expected a pull detail');
    expect(result.detail.pull).not.toHaveProperty('reviewerStates');
  });

  it('fails a state it does not know', async () => {
    await expect(read(answer(pull([{ id: '9', login: 'ann', state: 'rejected' }]))))
      .rejects.toThrow('Invalid option');
  });
});
