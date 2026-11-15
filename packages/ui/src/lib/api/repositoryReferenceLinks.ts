export type RepositoryReferenceReviewer = {
  id: string;
  login: string;
  avatarUrl?: string;
};

export type RepositoryReferenceLink = {
  kind: 'issue' | 'pull' | 'discussion';
  number: number;
  title?: string;
  url: string;
  repo?: string;
  createdAt: string | null;
  author?: { login: string; avatarUrl?: string } | null;
  willCloseTarget?: boolean;
};
