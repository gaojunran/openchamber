import { describe, expect, it, vi } from 'vitest';

import type { SourceControlReadContext } from '@openchamber/ui/lib/api/types';
import { fetchChangeRequestReviewState, fetchRepositoryReferenceDetail } from './repository-references';

const context: SourceControlReadContext = {
  provider: 'github',
  instance: 'github.com',
  directory: '/workspace/app',
  repositoryId: 'repo_one',
  accountId: 'github.com#7',
  bindingRevision: 4,
  primaryRemote: 'origin',
};

const item = { owner: 'acme', repo: 'app', number: 12 };

type ReviewWire = { id: string; state: string; author?: { login: string } | null; submittedAt: string | null };
type ThreadWire = { id: string; resolved: boolean; canResolve: boolean; canReply: boolean; outdated?: boolean; replies: never[] };
type PullWire = {
  reviewDecision: 'approved' | 'changes_requested' | 'review_required';
  reviewers: never[];
  reviews?: ReviewWire[];
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: never[];
  commitTotal: number;
};
type ReviewStateThreadWire = {
  id: string;
  path: string;
  side: 'old' | 'new';
  line: number | null;
  startLine: number | null;
  resolved: boolean;
  canReply: boolean;
  canResolve: boolean;
  comments: never[];
};

const review: ReviewWire = { id: 'R1', state: 'approved', author: { login: 'hubot' }, submittedAt: '2026-01-02T00:00:00Z' };

type DetailOptions = { withReviews?: boolean; emptyReviews?: boolean; topLevelReviews?: boolean; review?: ReviewWire; extraReviews?: ReviewWire[] };

const detailPayload = (options: DetailOptions = {}) => {
  const thread: ThreadWire = { id: 'T1', resolved: false, canResolve: true, canReply: true, replies: [] };
  const pull: PullWire = {
    reviewDecision: 'changes_requested',
    reviewers: [],
    additions: 3,
    deletions: 1,
    changedFiles: 2,
    commits: [],
    commitTotal: 0,
  };
  if (options.emptyReviews === true) pull.reviews = [];
  else if (options.withReviews !== false && options.topLevelReviews !== true) pull.reviews = [options.review ?? review, ...(options.extraReviews ?? [])];
  const detail = {
    number: 12,
    comments: [
      {
        author: { login: 'mona' },
        body: 'Needs a test',
        createdAt: '2026-01-01T00:00:00Z',
        url: 'https://github.com/acme/app/pull/12#c1',
        path: 'src/login.ts',
        line: 12,
        review: 'commented',
        thread,
      },
    ],
    commentTotal: 1,
    pull,
  };
  if (options.topLevelReviews === true) Object.assign(detail, { reviews: [options.review ?? review] });
  return { connected: true as const, detail };
};

const reviewStatePayload = () => {
  const thread: ReviewStateThreadWire = {
    id: 'T1',
    path: 'src/login.ts',
    side: 'new',
    line: 12,
    startLine: null,
    resolved: false,
    canReply: true,
    canResolve: true,
    comments: [],
  };
  return { connected: true as const, viewerIsAuthor: false, headSha: 'f'.repeat(40), draft: null, threads: [thread], truncated: false };
};

const answerWith = <T,>(payload: T) => vi.fn(async () => Response.json(payload));

const readDetail = async (payload: ReturnType<typeof detailPayload>) => {
  const result = await fetchRepositoryReferenceDetail(answerWith(payload), context, item);
  if (!result.connected || !result.detail?.pull) throw new Error('Expected a connected detail with a pull');
  return result.detail;
};

describe('reading a change request detail', () => {
  it("keeps the host's reviews", async () => {
    const detail = await readDetail(detailPayload());
    expect(detail.pull?.reviews).toEqual([review]);
  });

  it('leaves reviews outside pull out of the preview', async () => {
    const detail = await readDetail(detailPayload({ topLevelReviews: true }));
    expect('reviews' in (detail.pull ?? {})).toBe(false);
  });

  it('leaves absent reviews absent, never defaulted', async () => {
    const detail = await readDetail(detailPayload({ withReviews: false }));
    expect('reviews' in (detail.pull ?? {})).toBe(false);
  });

  it('drops a review whose state the client does not know, and keeps the rest', async () => {
    const detail = await readDetail(detailPayload({ extraReviews: [{ id: 'R2', state: 'approved-ish', author: { login: 'hubot' }, submittedAt: null }] }));
    expect(detail.pull?.reviews).toEqual([review]);
  });

  it('drops a review with no author field at all, and keeps the rest', async () => {
    const detail = await readDetail(detailPayload({ extraReviews: [{ id: 'R2', state: 'approved', submittedAt: null }] }));
    expect(detail.pull?.reviews).toEqual([review]);
  });

  it('calls an answer no entry holds together unknown, not empty', async () => {
    const detail = await readDetail(detailPayload({ review: { id: 'R1', state: 'approved-ish', author: { login: 'hubot' }, submittedAt: null } }));
    expect('reviews' in (detail.pull ?? {})).toBe(false);
  });

  it('keeps a truly empty answer empty', async () => {
    const detail = await readDetail(detailPayload({ emptyReviews: true }));
    expect(detail.pull?.reviews).toEqual([]);
  });
});

describe('reading a change request review', () => {
  it('reads a connected review state', async () => {
    const result = await fetchChangeRequestReviewState(answerWith(reviewStatePayload()), context, item);
    if (!result.connected) throw new Error('Expected a connected review');
    expect(result.threads).toHaveLength(1);
  });
});
