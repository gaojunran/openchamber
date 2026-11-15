import { z } from 'zod';

const PULL_STATES = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' };

const STACK_LAYER_LIMIT = 50;

const STACK_QUERY = `
query PullStack($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on PullRequest {
        stack {
          number
          baseRefName
          entries(first: ${STACK_LAYER_LIMIT}) {
            nodes { position pullRequest { number title url state isDraft headRefName } }
          }
        }
      }
    }
  }
}
`;

const stackSchema = z.object({
  repository: z.object({
    issueOrPullRequest: z.object({
      __typename: z.string(),
      stack: z.object({
        number: z.number().int(),
        baseRefName: z.string(),
        entries: z.object({
          nodes: z.array(z.object({
            position: z.number().int(),
            pullRequest: z.object({
              number: z.number().int(),
              title: z.string(),
              url: z.string(),
              state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
              isDraft: z.boolean(),
              headRefName: z.string(),
            }).nullable(),
          })),
        }),
      }).nullable().optional(),
    }).nullable(),
  }).nullable(),
});

export async function fetchPullStack({ octokit, owner, repo, number }) {
  const parsed = stackSchema.parse(await octokit.graphql(STACK_QUERY, { owner, repo, number }));
  const stack = parsed.repository?.issueOrPullRequest?.stack;
  if (!stack) return null;
  const layers = stack.entries.nodes
    .filter((entry) => entry.pullRequest !== null)
    .sort((left, right) => left.position - right.position)
    .map(({ pullRequest }) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: PULL_STATES[pullRequest.state],
      draft: pullRequest.isDraft,
      head: pullRequest.headRefName,
    }));
  return { number: stack.number, base: stack.baseRefName, layers };
}
