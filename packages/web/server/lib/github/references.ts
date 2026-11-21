import { z } from 'zod';
import type { Octokit } from '@octokit/rest';

export interface GitHubReferenceLink {
  kind: 'issue' | 'pull';
  number: number;
  url: string;
  createdAt: string | null;
  author: { login: string; avatarUrl?: string } | null;
  title?: string;
  repo?: string;
  willCloseTarget?: boolean;
}

const toAuthor = (author: { login: string; avatarUrl?: string | null | undefined } | null): GitHubReferenceLink['author'] =>
  (!author ? null : (author.avatarUrl ? { login: author.login, avatarUrl: author.avatarUrl } : { login: author.login }));

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

export const timelineItemsField = { timelineItems: timelineItemsSchema };

export const TIMELINE_ITEMS_SELECTION = `timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 20) {
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
        }`;

type TimelineItem = z.infer<typeof crossReferenceSchema>;

type TimelineCarrier = { timelineItems?: { nodes: (TimelineItem | null)[] | null } | undefined };
type ReferenceCarrier = { references?: GitHubReferenceLink[] };

export const withReferences = <T>(base: T, references: readonly GitHubReferenceLink[]): T & Partial<ReferenceCarrier> =>
  (references.length > 0 ? Object.assign({}, base, { references: [...references] }) : Object.assign({}, base));

export const toReferences = (item: TimelineCarrier): GitHubReferenceLink[] =>
  (item.timelineItems?.nodes ?? []).flatMap((node) => {
    const source = node?.source;
    const number = Number(source?.number);
    if (!source || !Number.isSafeInteger(number) || !source.url) return [];
    const reference: GitHubReferenceLink = {
      kind: source.__typename === 'PullRequest' ? 'pull' : 'issue',
      number,
      url: source.url,
      createdAt: node.createdAt ?? null,
      author: toAuthor(node.actor ?? null),
    };
    if (source.title) reference.title = source.title;
    if (source.repository?.nameWithOwner) reference.repo = source.repository.nameWithOwner;
    if (node.willCloseTarget != null) reference.willCloseTarget = node.willCloseTarget;
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

export const referencesField = async (
  octokit: Octokit, owner: string, repo: string, number: number,
): Promise<{ references?: GitHubReferenceLink[] }> => {
  const references = await fetchReferenceLinks({ octokit, owner, repo, number }).catch((): GitHubReferenceLink[] => []);
  return references.length > 0 ? { references } : {};
};

export async function fetchReferenceLinks({ octokit, owner, repo, number }: {
  octokit: Octokit; owner: string; repo: string; number: number;
}): Promise<GitHubReferenceLink[]> {
  const parsed = referenceLinksSchema.parse(await octokit.graphql(REFERENCE_LINKS_QUERY, { owner, repo, number }));
  const item = parsed.repository?.issueOrPullRequest;
  return item ? toReferences(item) : [];
}
