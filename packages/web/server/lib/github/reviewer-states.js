export const toAuthor = (author) => (author ? { login: author.login, avatarUrl: author.avatarUrl ?? undefined } : null);

export const toReviewers = (reviewRequests) => reviewRequests.flatMap(({ requestedReviewer: reviewer }) => (
  reviewer?.__typename === 'User' && reviewer.login
    ? [{ id: reviewer.login, ...toAuthor({ login: reviewer.login, avatarUrl: reviewer.avatarUrl }) }]
    : []
));

const REVIEWER_STATES = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
  DISMISSED: 'pending',
};

export const toReviewerStates = (reviews, reviewRequests) => {
  const states = new Map();
  const created = (review) => Date.parse(review.createdAt ?? '') || 0;
  for (const review of [...reviews].sort((left, right) => created(left) - created(right))) {
    const login = review.author?.login;
    const state = REVIEWER_STATES[review.state];
    if (login && state) states.set(login, { id: login, ...toAuthor(review.author), state });
  }
  for (const { requestedReviewer: reviewer } of reviewRequests) {
    if (reviewer?.__typename !== 'User' || !reviewer.login || states.has(reviewer.login)) continue;
    states.set(reviewer.login, { id: reviewer.login, ...toAuthor(reviewer), state: 'pending' });
  }
  return [...states.values()];
};
