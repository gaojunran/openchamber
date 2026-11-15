import { isPlainObject, isString } from './validation.js';

const asArray = (value) => (Array.isArray(value) ? value : []);
export const projectPath = (owner, name) => `${owner}/${name}`;

const REFERENCE_NOTE = /^mentioned in /;
const REFERENCE_TOKEN = /(?:issue|merge request)\s+((?:[\w.-]+\/)+[\w.-]+)?([#!])(\d+)/g;

export function systemReferences(notes, webUrl, ownPath) {
  let base;
  try {
    base = new URL(webUrl).origin;
  } catch {
    return [];
  }
  if (!isString(ownPath) || !ownPath) return [];
  const references = [];
  for (const note of asArray(notes)) {
    if (!isPlainObject(note) || note.system !== true || !isString(note.body) || !REFERENCE_NOTE.test(note.body)) continue;
    const createdAt = isString(note.created_at) && note.created_at ? note.created_at : null;
    let author = null;
    if (isPlainObject(note.author) && isString(note.author.username) && note.author.username) {
      author = { login: note.author.username };
      if (isString(note.author.avatar_url) && note.author.avatar_url) author.avatarUrl = note.author.avatar_url;
    }
    for (const [, path, marker, digits] of note.body.matchAll(REFERENCE_TOKEN)) {
      const number = Number(digits);
      if (!Number.isSafeInteger(number) || number < 1) continue;
      const repo = path ?? ownPath;
      const mergeRequest = marker === '!';
      references.push({
        kind: mergeRequest ? 'pull' : 'issue',
        number,
        url: `${base}/${repo}/-/${mergeRequest ? 'merge_requests' : 'issues'}/${number}`,
        repo,
        createdAt,
        author,
      });
    }
  }
  return references.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

export async function readIssueReferences(client, project, number, webUrl) {
  try {
    const notes = await client.IssueNotes.all(project.id, number, {
      sort: 'desc', orderBy: 'created_at', perPage: 100, maxPages: 1,
    });
    return Array.isArray(notes) ? systemReferences(notes, webUrl, projectPath(project.owner, project.name)) : [];
  } catch {
    return [];
  }
}
