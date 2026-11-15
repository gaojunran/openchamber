import type { SourceControlReferenceLink } from '@openchamber/ui/lib/api/types';

type BoundaryScalar = string | number | boolean | null | undefined;

const isStringValue = (value: BoundaryScalar): value is string => Object.prototype.toString.call(value) === '[object String]';
const isNonEmptyString = (value: BoundaryScalar): value is string => isStringValue(value) && value.trim().length > 0;

export const isHttpUrl = (value: BoundaryScalar): value is string => {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const REFERENCE_KINDS: readonly SourceControlReferenceLink['kind'][] = ['issue', 'pull', 'discussion'];

export const parseSourceReferenceLinks = (references: SourceControlReferenceLink[]): SourceControlReferenceLink[] => {
  if (!Array.isArray(references)) throw new Error('Source control response contained invalid issue references');
  return references.map((reference) => {
    if (!reference || !REFERENCE_KINDS.includes(reference.kind) || !Number.isInteger(reference.number) || reference.number < 1
      || !isHttpUrl(reference.url)
      || (reference.title !== undefined && !isStringValue(reference.title))
      || (reference.repo !== undefined && !isStringValue(reference.repo))
      || (reference.createdAt !== null && !isNonEmptyString(reference.createdAt))
      || (reference.willCloseTarget !== undefined && Object.prototype.toString.call(reference.willCloseTarget) !== '[object Boolean]')
      || (reference.author !== undefined && reference.author !== null
        && (!reference.author || !isNonEmptyString(reference.author.login)
          || (reference.author.avatarUrl !== undefined && !isStringValue(reference.author.avatarUrl))))) {
      throw new Error('Source control response contained an invalid reference link');
    }
    return reference;
  });
};
