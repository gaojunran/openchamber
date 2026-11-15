import { z } from 'zod';

const toAuthor = (author) => (author ? { login: author.login, avatarUrl: author.avatarUrl ?? undefined } : null);

const crossReferenceSchema = z.object({
  createdAt: z.string().nullable().optional(),
  willCloseTarget: z.boolean().nullable().optional(),
  actor: z.object({ login: z.string(), avatarUrl: z.string().nullable().optional() }).nullable().optional(),
  source: z.object({
    __typename: z.string(),
    number: z.number().int().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    repository: z.object({ nameWithOwner: z.string() }).nullable().optional(),
  }).nullable().optional(),
}).nullable();

export const timelineItemsSchema = z.object({ nodes: z.array(crossReferenceSchema).nullable() }).optional();

export const toReferences = (item) => (item.timelineItems?.nodes ?? []).flatMap((node) => {
  const source = node?.source;
  if (!source || !Number.isSafeInteger(source.number) || !source.url) return [];
  const reference = {
    kind: source.__typename === 'PullRequest' ? 'pull' : 'issue',
    number: source.number,
    url: source.url,
    createdAt: node.createdAt ?? null,
    author: toAuthor(node.actor ?? null),
  };
  if (source.title) reference.title = source.title;
  if (source.repository?.nameWithOwner) reference.repo = source.repository.nameWithOwner;
  if (node.willCloseTarget === true || node.willCloseTarget === false) reference.willCloseTarget = node.willCloseTarget;
  return [reference];
});

const REFERENCE_LINKS_QUERY = `
query ReferenceLinks($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      ... on Issue {
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 20) {
          nodes {
            ... on CrossReferencedEvent {
              createdAt
              willCloseTarget
              actor { login avatarUrl }
              source {
                __typename
                ... on Issue { number title state url repository { nameWithOwner } }
                ... on PullRequest { number title state isDraft url repository { nameWithOwner } }
              }
            }
          }
        }
      }
      ... on PullRequest {
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 20) {
          nodes {
            ... on CrossReferencedEvent {
              createdAt
              willCloseTarget
              actor { login avatarUrl }
              source {
                __typename
                ... on Issue { number title state url repository { nameWithOwner } }
                ... on PullRequest { number title state isDraft url repository { nameWithOwner } }
              }
            }
          }
        }
      }
    }
  }
}
`;

const referenceLinksSchema = z.object({
  repository: z.object({
    issueOrPullRequest: z.object({
      timelineItems: timelineItemsSchema,
    }).nullable(),
  }).nullable(),
});

export async function fetchReferenceLinks({ octokit, owner, repo, number }) {
  const parsed = referenceLinksSchema.parse(await octokit.graphql(REFERENCE_LINKS_QUERY, { owner, repo, number }));
  const item = parsed.repository?.issueOrPullRequest;
  return item ? toReferences(item) : [];
}
