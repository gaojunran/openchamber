import { mapGiteaCommit } from './mappers.js';
import { isPlainObject, isString } from '../shared/guards.js';

const PAGE_LIMIT = 50;
const TIMELINE_COMMIT_LIMIT = 50;

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
  return page.items.flatMap((entry) => {
    const target = entry?.ref_issue;
    if (!isPlainObject(entry) || (entry.type !== 'issue_ref' && entry.type !== 'pull_ref')
      || !isPlainObject(target) || !Number.isInteger(target.number) || !isString(target.html_url) || !target.html_url) return [];
    const reference = {
      kind: entry.type === 'pull_ref' ? 'pull' : 'issue',
      number: target.number,
      url: target.html_url,
      createdAt: isString(entry.created_at) && entry.created_at ? entry.created_at : null,
    };
    if (isString(target.title) && target.title) reference.title = target.title;
    if (isString(target.repository?.full_name) && target.repository.full_name) reference.repo = target.repository.full_name;
    const user = entry.user;
    if (isPlainObject(user) && isString(user.login) && user.login) {
      reference.author = isString(user.avatar_url) && user.avatar_url
        ? { login: user.login, avatarUrl: user.avatar_url }
        : { login: user.login };
    }
    return [reference];
  }).sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}
