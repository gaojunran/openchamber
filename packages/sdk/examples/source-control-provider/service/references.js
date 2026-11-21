// packages/sdk/examples/source-control-provider/service/references.ts
var REFERENCE_EVENT_TYPES = new Set(["issue_ref", "pull_ref", "comment_ref"]);
var authorOf = (user) => {
  if (!user)
    return;
  const login = user.login;
  if (!login || String(login) !== login)
    return;
  const author = { login };
  const avatar = user.avatar_url;
  if (avatar && String(avatar) === avatar)
    author.avatarUrl = avatar;
  return author;
};
var isPullTarget = (event, target, url) => event.type === "pull_ref" || target.pull_request !== null && Object(target.pull_request) === target.pull_request || /\/pulls\/\d+(?:$|[?#/])/.test(url);
var mapTimelineReferences = (entries) => {
  const references = new Map;
  for (const event of entries ?? []) {
    if (!event || !REFERENCE_EVENT_TYPES.has(String(event.type)))
      continue;
    const target = event.ref_issue;
    if (!target || !Number.isSafeInteger(target.number))
      continue;
    const url = target.html_url;
    if (!url || String(url) !== url)
      continue;
    const comment = event.type === "comment_ref" ? event.ref_comment : undefined;
    const created = comment?.created_at ?? event.created_at;
    const createdAt = created && String(created) === created ? created : null;
    const reference = {
      kind: isPullTarget(event, target, url) ? "pull" : "issue",
      number: Number(target.number),
      url,
      createdAt
    };
    const title = target.title;
    if (title && String(title) === title)
      reference.title = title;
    const repo = target.repository?.full_name;
    if (repo && String(repo) === repo)
      reference.repo = repo;
    const author = authorOf(comment?.user ?? event.user);
    if (author)
      reference.author = author;
    const previous = references.get(reference.url);
    if (!previous || String(createdAt ?? "") < String(previous.createdAt ?? ""))
      references.set(reference.url, reference);
  }
  return [...references.values()].sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
};
var readReferences = async (page) => {
  if (page === null)
    return [];
  try {
    return mapTimelineReferences((await page).data);
  } catch {
    return [];
  }
};
var withReferences = (detail, references) => references.length > 0 ? { ...detail, references } : detail;
export {
  mapTimelineReferences,
  readReferences,
  withReferences
};
