import { describe, expect, it, vi } from 'vitest';

import type { RepositoryReferenceDetail, RepositoryReferenceLink, SourceControlReadContext } from '@openchamber/ui/lib/api/types';
import { fetchRepositoryReferenceDetail } from './repository-references';

const context: SourceControlReadContext = {
  provider: 'github', instance: 'github.com', accountId: 'github.com#1',
  repositoryId: 'repo-1', bindingRevision: 1, directory: '/repo', primaryRemote: 'origin',
};

const item = { owner: 'gaojunran', repo: 'me', number: 2 };

const reference: RepositoryReferenceLink = {
  kind: 'issue', number: 5, title: 'The header story', url: 'https://github.com/gaojunran/me/issues/5',
  repo: 'gaojunran/me', createdAt: '2026-11-12T16:47:27Z', author: { login: 'gaojunran' }, willCloseTarget: false,
};

type DetailPayload = { connected: true; detail: RepositoryReferenceDetail };

const detail = (overrides: Partial<RepositoryReferenceDetail> = {}): DetailPayload => ({
  connected: true,
  detail: { number: 2, comments: [], commentTotal: 0, pull: null, ...overrides },
});

const fetchOf = (body: string) => vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));

const readWith = (payload: DetailPayload) => (
  fetchRepositoryReferenceDetail(fetchOf(JSON.stringify(payload)), context, item)
);

const readRaw = (body: string) => fetchRepositoryReferenceDetail(fetchOf(body), context, item);

describe('reference detail references', () => {
  it('keeps the cross-references the detail names', async () => {
    const result = await readWith(detail({ references: [reference] }));
    if (!result.connected) throw new Error('expected a connected read');
    expect(result.detail?.references).toEqual([reference]);
  });

  it('leaves the key absent when the detail names none', async () => {
    const result = await readWith(detail());
    if (!result.connected) throw new Error('expected a connected read');
    expect(result.detail).not.toHaveProperty('references');
  });

  it('drops a malformed cross-reference without failing the rest of the read', async () => {
    const raw = (references: unknown) => readRaw(JSON.stringify({ connected: true, detail: {
      number: 2, comments: [], commentTotal: 0, pull: null, references,
    } }));
    const badKind = await raw([{ ...reference, kind: 'sticky' }]);
    expect(badKind.connected && badKind.detail).not.toHaveProperty('references');
    const badNumber = await raw([{ ...reference, number: '5' }]);
    expect(badNumber.connected && badNumber.detail).not.toHaveProperty('references');
    const badUrl = await raw([{ ...reference, url: 'ftp://example.test/5' }]);
    expect(badUrl.connected && badUrl.detail).not.toHaveProperty('references');
    const notAList = await raw({});
    expect(notAList.connected).toBe(true);
    const mixed = await raw([{ ...reference, kind: 'sticky' }, reference]);
    if (!mixed.connected || mixed.detail === null) throw new Error('expected a connected read');
    expect(mixed.detail.references).toEqual([reference]);
  });
});
