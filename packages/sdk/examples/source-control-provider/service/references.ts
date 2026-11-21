import type { SourceControlReferenceLink } from '@openchamber/sdk';

export type ReferenceUser = { login?: string; avatar_url?: string };

export type ReferenceTarget = {
  number?: number;
  html_url?: string;
  title?: string;
  repository?: { full_name?: string };
  pull_request?: object | null;
};

export type ReferenceEvent = {
  type?: string;
  created_at?: string;
  user?: ReferenceUser;
  ref_issue?: ReferenceTarget;
  ref_comment?: { created_at?: string; user?: ReferenceUser };
};

type ReferenceAuthor = { login: string; avatarUrl?: string };

type TimelinePage = { data: ReferenceEvent[] | null };

const REFERENCE_EVENT_TYPES = new Set(['issue_ref', 'pull_ref', 'comment_ref']);

const authorOf = (user: ReferenceUser | undefined): ReferenceAuthor | undefined => {
  if (!user) return undefined;
  const login = user.login;
  if (!login || String(login) !== login) return undefined;
  const author: ReferenceAuthor = { login };
  const avatar = user.avatar_url;
  if (avatar && String(avatar) === avatar) author.avatarUrl = avatar;
  return author;
};

const isPullTarget = (event: ReferenceEvent, target: ReferenceTarget, url: string): boolean =>
  event.type === 'pull_ref'
  || (target.pull_request !== null && Object(target.pull_request) === target.pull_request)
  || /\/pulls\/\d+(?:$|[?#/])/.test(url);

export const mapTimelineReferences = (entries: ReferenceEvent[] | null): SourceControlReferenceLink[] => {
  const references = new Map<string, SourceControlReferenceLink>();
  for (const event of entries ?? []) {
    if (!event || !REFERENCE_EVENT_TYPES.has(String(event.type))) continue;
    const target = event.ref_issue;
    if (!target || !Number.isSafeInteger(target.number)) continue;
    const url = target.html_url;
    if (!url || String(url) !== url) continue;
    const comment = event.type === 'comment_ref' ? event.ref_comment : undefined;
    const created = comment?.created_at ?? event.created_at;
    const createdAt = created && String(created) === created ? created : null;
    const reference: SourceControlReferenceLink = {
      kind: isPullTarget(event, target, url) ? 'pull' : 'issue',
      number: Number(target.number),
      url,
      createdAt,
    };
    const title = target.title;
    if (title && String(title) === title) reference.title = title;
    const repo = target.repository?.full_name;
    if (repo && String(repo) === repo) reference.repo = repo;
    const author = authorOf(comment?.user ?? event.user);
    if (author) reference.author = author;
    const previous = references.get(reference.url);
    if (!previous || String(createdAt ?? '') < String(previous.createdAt ?? '')) references.set(reference.url, reference);
  }
  return [...references.values()].sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')));
};

export const readReferences = async (page: Promise<TimelinePage> | null): Promise<SourceControlReferenceLink[]> => {
  if (page === null) return [];
  try {
    return mapTimelineReferences((await page).data);
  } catch {
    return [];
  }
};

export const withReferences = <T extends object>(detail: T, references: SourceControlReferenceLink[]): T & { references?: SourceControlReferenceLink[] } =>
  (references.length > 0 ? { ...detail, references } : detail);

export type ReferencesApi = {
  readReferences: (page: Promise<TimelinePage> | null) => Promise<SourceControlReferenceLink[]>;
  withReferences: <T extends object>(detail: T, references: SourceControlReferenceLink[]) => T & { references?: SourceControlReferenceLink[] };
};
