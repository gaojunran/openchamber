export type ChangedFile = {
  path: string; status: 'added' | 'removed' | 'renamed' | 'modified';
  additions?: number; deletions?: number; changes?: number; patch?: string;
};

type GiteaChangedFile = { filename: string; status?: string; additions?: number; deletions?: number; changes?: number };

const FILE_STATUSES = new Map<string, ChangedFile['status']>([['added', 'added'], ['deleted', 'removed'], ['removed', 'removed'], ['renamed', 'renamed']]);

export const mapChangedFile = (raw: GiteaChangedFile): ChangedFile => {
  const file: ChangedFile = { path: raw.filename, status: FILE_STATUSES.get(raw.status ?? '') ?? 'modified' };
  if (raw.additions !== undefined) file.additions = raw.additions;
  if (raw.deletions !== undefined) file.deletions = raw.deletions;
  if (raw.changes !== undefined) file.changes = raw.changes;
  return file;
};

export const splitUnifiedDiff = (diff: string): Map<string, string> => {
  const parts = new Map<string, string>();
  const chunks = diff.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith('diff --git '));
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const plus = lines.find((line) => line.startsWith('+++ '));
    const minus = lines.find((line) => line.startsWith('--- '));
    const renamed = lines.find((line) => line.startsWith('rename to '));
    let path = '';
    if (plus && plus !== '+++ /dev/null') path = plus.slice(4).replace(/^b\//, '');
    else if (renamed) path = renamed.slice('rename to '.length);
    else if (minus && minus !== '--- /dev/null') path = minus.slice(4).replace(/^a\//, '');
    else path = lines[0].match(/^diff --git a\/.+? b\/(.+)$/)?.[1] ?? '';
    if (path) parts.set(path.replace(/\t.*$/, ''), chunk.endsWith('\n') ? chunk : `${chunk}\n`);
  }
  return parts;
};

export type DiffApi = {
  mapChangedFile: (raw: GiteaChangedFile) => ChangedFile;
  splitUnifiedDiff: (diff: string) => Map<string, string>;
};
