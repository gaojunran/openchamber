export type SourceControlReferenceLink = {
  kind: 'issue' | 'pull';
  number: number;
  url: string;
  createdAt: string | null;
  title?: string;
  repo?: string;
  author?: { login: string; avatarUrl?: string };
};

export type SourceControlIssueDetail = {
  references?: SourceControlReferenceLink[];
};

export type SourceControlChangeRequestContext = {
  references?: SourceControlReferenceLink[];
};
