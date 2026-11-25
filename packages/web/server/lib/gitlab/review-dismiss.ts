import { approvalRulesOf, approversOf, readApprovedBy } from './review-summaries.js';
import { isPlainObject, isString } from './validation.js';
import type { JsonValue } from '../shared/json-values.js';
import type { createGitLabClient } from './client.js';

type Client = ReturnType<typeof createGitLabClient>;
type NumberedTarget = { projectId: string; number: number };

const isJsonObject = (value: JsonValue | undefined): value is Record<string, JsonValue | undefined> => isPlainObject(value);
const at = (value: JsonValue | undefined, key: string): JsonValue | undefined => (isJsonObject(value) ? value[key] : undefined);

export async function dismissReview(client: Client, providerTarget: NumberedTarget) {
  const { projectId, number } = providerTarget;
  await client.MergeRequestApprovals.unapprove(projectId, number);
  return {};
}

export async function reconcileReviewDismiss(client: Client, providerTarget: NumberedTarget): Promise<{ state: string; result?: object }> {
  const { projectId, number } = providerTarget;
  const [state, viewer] = await Promise.all([
    client.MergeRequestApprovals.showApprovalState(projectId, number).catch(() => null),
    client.Users.showCurrentUser().catch(() => null),
  ]);
  if (state === null) return { state: 'outcome-unknown' };
  // SAFETY: the GitLab requester parses a JSON body for the approval state.
  const approvalState = state as JsonValue;
  // SAFETY: the GitLab requester parses a JSON body for the current user.
  const currentUser = viewer as JsonValue;
  const viewerName = at(currentUser, 'username');
  if (!isString(viewerName) || !viewerName) return { state: 'outcome-unknown' };
  const rules = approvalRulesOf(approvalState);
  if (!rules.length && !at(approvalState, 'rules') && !at(approvalState, 'approval_rules')) return { state: 'outcome-unknown' };
  if (rules.length) {
    const viewerId = at(currentUser, 'id');
    if (!Number.isInteger(viewerId)) return { state: 'outcome-unknown' };
    return approversOf(rules).some((approver) => at(approver, 'id') === viewerId)
      ? { state: 'outcome-unknown' } : { state: 'succeeded', result: {} };
  }
  const project = await client.Projects.show(projectId).catch(() => null);
  // SAFETY: the GitLab requester parses a JSON body for the project.
  const projectPath = at(project as JsonValue, 'path_with_namespace');
  if (!isString(projectPath) || !projectPath) return { state: 'outcome-unknown' };
  const approvedBy = await readApprovedBy(client, projectPath, number);
  if (approvedBy === null) return { state: 'outcome-unknown' };
  return approvedBy.some((approver) => at(approver, 'username') === viewerName)
    ? { state: 'outcome-unknown' } : { state: 'succeeded', result: {} };
}
