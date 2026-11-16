import { mapGitLabUser } from './mappers.js';
import { isPlainObject, isString } from './validation.js';

const REVIEWER_STATES = { unreviewed: 'pending', reviewed: 'commented', approved: 'approved', requested_changes: 'changes_requested' };

const requestStatus = (error) => error?.cause?.response?.status ?? error?.response?.status ?? error?.status;

const DIFF_STATS_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) { diffStats { path additions deletions } }
  }
}`;

export const readDiffStats = async (client, project, number) => {
  try {
    const response = await client.MergeRequests.requester.post('../graphql', {
      body: { query: DIFF_STATS_QUERY, variables: { path: `${project.owner}/${project.name}`, iid: String(number) } },
    });
    const stats = response?.body?.data?.project?.mergeRequest?.diffStats;
    if (!Array.isArray(stats)) return null;
    const byPath = new Map();
    for (const entry of stats) {
      if (!isPlainObject(entry) || !isString(entry.path) || !Number.isInteger(entry.additions) || !Number.isInteger(entry.deletions)) return null;
      byPath.set(entry.path, { additions: entry.additions, deletions: entry.deletions });
    }
    return byPath;
  } catch {
    return null;
  }
};

export const readReviewerStates = async (client, projectId, number, raw, identity) => {
  let reviewers;
  try {
    reviewers = await client.MergeRequests.showReviewers(projectId, number);
  } catch (error) {
    if (requestStatus(error) !== 404) throw error;
    return undefined;
  }
  if (!Array.isArray(reviewers)) return undefined;
  const states = new Map();
  for (const entry of reviewers) {
    const user = mapGitLabUser(entry?.user, identity);
    const state = REVIEWER_STATES[entry?.state];
    if (user && state && !states.has(user.id)) states.set(user.id, { user, state });
  }
  if (states.size === 0) {
    for (const user of Array.isArray(raw?.approvals?.approved_by) ? raw.approvals.approved_by : []) {
      const mapped = mapGitLabUser(user, identity);
      if (mapped) states.set(mapped.id, { user: mapped, state: 'approved' });
    }
  }
  return [...states.values()];
};
