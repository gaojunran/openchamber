export interface CommentThreadRef {
  id: string;
  resolved: boolean;
  /** Whether the thread is one that waits to be resolved. */
  resolvable: boolean;
  /** Whether this comment opened the thread; the others answer it. */
  first: boolean;
  /** This account's permissions, when the host said; absent means unknown. */
  canResolve?: boolean;
  canReply?: boolean;
}

export interface SourceControlReferenceLink {
  kind: 'issue' | 'pull' | 'discussion';
  number: number;
  title?: string;
  url: string;
  repo?: string;
  createdAt: string | null;
  author?: { login: string; avatarUrl?: string } | null;
  willCloseTarget?: boolean;
}
