import { mapGiteaCommit } from './mappers.js';
import { isPlainObject, isString } from '../shared/guards.js';

const PAGE_LIMIT = 50;
const TIMELINE_COMMIT_LIMIT = 50;
const REFERENCE_EVENT_TYPES = new Set(['issue_ref', 'pull_ref', 'comment_ref']);

const isPullTarget = (entry, target) => entry.type === 'pull_ref'
  || isPlainObject(target.pull_request)
  || (isString(target.html_url) && /\/pulls\/\d+(?:$|[?#/])/.test(target.html_url));

const userOf = (value) => (isPlainObject(value) && isString(value.login) && value.login
  ? (isString(value.avatar_url) && value.avatar_url
    ? { login: value.login, avatarUrl: value.avatar_url }
    : { login: value.login })
  : undefined);

export async function readTimelineCommits(client, repo, number) {
  const first = await client.page(`${repo}/pulls/${number}/commits`, { files: false, verification: false }, { page: 1, limit: TIMELINE_COMMIT_LIMIT });
  const items = first.items.flatMap((commit) => {
    const mapped = mapGiteaCommit(commit);
    return mapped ? [mapped] : [];
  }).reverse();
  return { items, complete: !first.hasMore };
}

export async function readTimelineReferences(client, repo, number) {
  let page;
  try {
    page = await client.page(`${repo}/issues/${number}/timeline`, {}, { page: 1, limit: PAGE_LIMIT });
  } catch {
    return [];
  }
  const references = new Map();
  for (const entry of page.items) {
    const target = entry?.ref_issue;
    if (!isPlainObject(entry) || !REFERENCE_EVENT_TYPES.has(entry.type)
      || !isPlainObject(target) || !Number.isInteger(target.number) || !isString(target.html_url) || !target.html_url) continue;
    const comment = entry.type === 'comment_ref' && isPlainObject(entry.ref_comment) ? entry.ref_comment : null;
    const createdAt = comment && isString(comment.created_at) && comment.created_at
      ? comment.created_at
      : (isString(entry.created_at) && entry.created_at ? entry.created_at : null);
    const reference = {
      kind: isPullTarget(entry, target) ? 'pull' : 'issue',
      number: target.number,
      url: target.html_url,
      createdAt,
    };
    if (isString(target.title) && target.title) reference.title = target.title;
    if (isString(target.repository?.full_name) && target.repository.full_name) reference.repo = target.repository.full_name;
    const author = userOf(comment?.user ?? entry.user);
    if (author) reference.author = author;
    // Two mentions of one item are one row; the earliest mention names it.
    const previous = references.get(reference.url);
    if (!previous || String(createdAt ?? '') < String(previous.createdAt ?? '')) references.set(reference.url, reference);
  }
  return [...references.values()].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}
