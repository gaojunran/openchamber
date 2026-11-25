import { z } from 'zod';
import { contextReviewFields, type ContextReviewFields } from './context-reviewers.js';
import { fieldAt } from './contracts.js';
import { isProviderString, requireProviderArray } from './mappers.js';
import type { GitHubEnvelope, Octokit } from './contracts.js';
import type { ReferenceReview } from './contracts.js';
import type { SourceControlReviewState, SourceControlReviewSummary } from '@openchamber/sdk';

export type ReferenceReviewNode = {
  databaseId?: number | null | undefined;
  state: string;
  createdAt: string | null;
  author: { login: string; avatarUrl?: string | null | undefined } | null;
};

interface ReferenceReviewStates { [state: string]: ReferenceReview['state'] | undefined }
const REVIEW_SUMMARY_STATES: ReferenceReviewStates = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', COMMENTED: 'commented', PENDING: 'pending', DISMISSED: 'dismissed',
};

export const toReferenceReviews = (nodes: ReferenceReviewNode[]): ReferenceReview[] => nodes.flatMap((review) => {
  const state = REVIEW_SUMMARY_STATES[review.state];
  if (!state) return [];
  const summary: ReferenceReview = {
    state,
    author: review.author ? { login: review.author.login, avatarUrl: review.author.avatarUrl ?? undefined } : null,
    submittedAt: review.createdAt ?? null,
  };
  if (Number.isSafeInteger(review.databaseId)) summary.id = String(review.databaseId);
  return [summary];
}).sort((left, right) => (Date.parse(right.submittedAt ?? '') || 0) - (Date.parse(left.submittedAt ?? '') || 0));

interface ReviewStates { [state: string]: SourceControlReviewState | undefined }
const REVIEW_STATES: ReviewStates = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', COMMENTED: 'commented', PENDING: 'pending', DISMISSED: 'dismissed',
};

const newestFirst = (left: SourceControlReviewSummary, right: SourceControlReviewSummary) =>
  (Date.parse(right.submittedAt ?? '') || 0) - (Date.parse(left.submittedAt ?? '') || 0);

interface ReviewAuthor { login: string; avatarUrl?: string }

const reviewSummaryOf = (review: GitHubEnvelope['data']): SourceControlReviewSummary | null => {
  const rawState = fieldAt(review, 'state');
  const state = isProviderString(rawState) ? REVIEW_STATES[rawState] : undefined;
  const id = fieldAt(review, 'id');
  if (!state || !Number.isSafeInteger(id)) return null;
  const user = fieldAt(review, 'user');
  const login = fieldAt(user, 'login');
  const avatarUrl = fieldAt(user, 'avatar_url');
  const author: ReviewAuthor | null = isProviderString(login) ? { login } : null;
  if (author && isProviderString(avatarUrl)) author.avatarUrl = avatarUrl;
  const submittedAt = fieldAt(review, 'submitted_at');
  return { id: String(id), state, author, submittedAt: isProviderString(submittedAt) ? submittedAt : null };
};

export type { ContextReviewFields } from './context-reviewers.js';

export async function readReviewSummaries(
  octokit: Octokit, route: { owner: string; repo: string }, number: number,
): Promise<SourceControlReviewSummary[]> {
  const summaries: SourceControlReviewSummary[] = [];
  for (let page = 1; page <= REVIEW_PAGE_LIMIT; page += 1) {
    const reviews = requireProviderArray(
      (await octokit.rest.pulls.listReviews({ ...route, pull_number: number, per_page: REVIEW_PAGE_SIZE, page }))?.data,
      'GitHub returned an invalid review list',
    );
    summaries.push(...reviews.flatMap((review) => {
      const summary = reviewSummaryOf(review);
      return summary ? [summary] : [];
    }));
    if (reviews.length < REVIEW_PAGE_SIZE) break;
  }
  return summaries.sort(newestFirst);
}

export const readReviewContext = async (
  octokit: Octokit, route: { owner: string; repo: string }, number: number,
  requested: readonly { login?: string | undefined; avatar_url?: string | undefined }[] | undefined,
  identity: { provider: string; instance: string },
): Promise<ContextReviewFields> => {
  const reviews = await readReviewSummaries(octokit, route, number).catch(() => undefined);
  const context = contextReviewFields(reviews ?? [], requested, identity);
  return reviews === undefined ? { reviewers: context.reviewers, reviewerStates: context.reviewerStates } : context;
};

const REVIEW_PAGE_SIZE = 100;
const REVIEW_PAGE_LIMIT = 20;
const REVIEWS_QUERY = `
query ReferenceReviews($owner: String!, $repo: String!, $number: Int!, $before: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviews(last: ${REVIEW_PAGE_SIZE}, before: $before) {
        pageInfo { hasPreviousPage startCursor }
        nodes { databaseId author { login avatarUrl } body state createdAt url }
      }
    }
  }
}`;
const reviewAuthorSchema = z.object({ login: z.string(), avatarUrl: z.string().nullable().optional() }).nullable();
const reviewNodeSchema = z.object({
  databaseId: z.number().int().nullish(),
  author: reviewAuthorSchema,
  body: z.string(),
  state: z.string(),
  createdAt: z.string().nullable(),
  url: z.string(),
});
const reviewsPageSchema = z.object({
  repository: z.object({
    pullRequest: z.object({
      reviews: z.object({
        pageInfo: z.object({ hasPreviousPage: z.boolean(), startCursor: z.string().nullish() }),
        nodes: z.array(z.unknown()),
      }),
    }).nullish(),
  }).nullish(),
});

type ReviewNode = z.infer<typeof reviewNodeSchema>;
export const readReferenceReviews = async (octokit: Octokit, owner: string, repo: string, number: number) => {
  const nodes: ReviewNode[] = [];
  let total = 0;
  let before: string | null = null;
  for (let page = 0; page < REVIEW_PAGE_LIMIT; page += 1) {
    const parsed = reviewsPageSchema.parse(await octokit.graphql(REVIEWS_QUERY, { owner, repo, number, before }));
    const reviews = parsed.repository?.pullRequest?.reviews;
    if (!reviews) break;
    total += reviews.nodes.length;
    for (const node of reviews.nodes) {
      const entry = reviewNodeSchema.safeParse(node);
      if (entry.success) nodes.push(entry.data);
    }
    if (!reviews.pageInfo.hasPreviousPage || !reviews.pageInfo.startCursor) break;
    before = reviews.pageInfo.startCursor;
  }
  return { nodes, total };
};
