/**
 * Covers what happens to the import step's payee answers when a merchant is created elsewhere
 *
 * The answer says which of a file's payee values have no merchant yet, so a merchant made while it
 * is cached would otherwise leave the step offering to create one that now exists
 */
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { merchantKeys, transactionKeys } from '@/api/cache/queryKeys';
import { updateMerchantCreateCaches, updateMerchantUpdateCaches } from '@/api/cache/updates/merchants';
import type { Merchant } from '@/api/merchants';

const CORNER_CAFE: Merchant = {
  id: 'corner-cafe',
  owner_id: 'user-1',
  group_id: null,
  name: 'Corner Cafe',
  is_system: false,
  default_category_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('creating a merchant while an import holds its payee answers', () => {
  it('marks the answers for every set of values as stale', () => {
    const queryClient = new QueryClient();
    const askedAbout = merchantKeys.nameMatches(['CORNER CAFE', 'SQ *COFFEE 4471']);
    queryClient.setQueryData(askedAbout, []);

    updateMerchantCreateCaches(queryClient, CORNER_CAFE);

    expect(queryClient.getQueryState(askedAbout)?.isInvalidated).toBe(true);
  });

  it('leaves the merchant detail it just wrote alone', () => {
    const queryClient = new QueryClient();

    updateMerchantCreateCaches(queryClient, CORNER_CAFE);

    // Written rather than asked for again, since the response the mutation returned is the record
    expect(queryClient.getQueryData(merchantKeys.detail(CORNER_CAFE.id))).toEqual(CORNER_CAFE);
    expect(queryClient.getQueryState(merchantKeys.detail(CORNER_CAFE.id))?.isInvalidated).toBe(false);
  });
});

describe('merchant usage ranking after mutations', () => {
  const zulu: Merchant = { ...CORNER_CAFE, id: 'zulu', name: 'Zulu Store' };
  const alpha: Merchant = { ...CORNER_CAFE, id: 'alpha', name: 'Alpha Store' };
  const listKey = merchantKeys.infinite({}, 1);
  const filteredKey = merchantKeys.infinite({ q: 'Zulu' }, 1);

  /** Seeds two pages in server usage order and a matching search result */
  function seedRankedPages(queryClient: QueryClient) {
    const rankedPages: InfiniteData<Merchant[]> = { pages: [[zulu], [alpha]], pageParams: [0, 1] };
    queryClient.setQueryData(listKey, rankedPages);
    queryClient.setQueryData(filteredKey, { pages: [[zulu]], pageParams: [0] });
    return rankedPages;
  }

  it('keeps ranked pages in place until a created merchant is fetched in server order', () => {
    const queryClient = new QueryClient();
    const rankedPages = seedRankedPages(queryClient);
    const merchant: Merchant = { ...CORNER_CAFE, id: 'mike', name: 'Mike Store' };

    updateMerchantCreateCaches(queryClient, merchant);

    expect(queryClient.getQueryData(listKey)).toEqual(rankedPages);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(filteredKey)).toEqual({ pages: [[zulu]], pageParams: [0] });
    expect(queryClient.getQueryState(filteredKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(merchantKeys.detail(merchant.id))).toEqual(merchant);
    expect(queryClient.getQueryState(merchantKeys.detail(merchant.id))?.isInvalidated).toBe(false);
  });

  it('refreshes default-category edits without sorting the loaded merchant pages', () => {
    const queryClient = new QueryClient();
    const rankedPages = seedRankedPages(queryClient);
    const merchant = { ...zulu, default_category_id: 'groceries' };

    updateMerchantUpdateCaches(queryClient, merchant, { default_category_id: 'groceries' });

    expect(queryClient.getQueryData(listKey)).toEqual(rankedPages);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(filteredKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(merchantKeys.detail(zulu.id))).toEqual(merchant);
    expect(queryClient.getQueryState(merchantKeys.detail(zulu.id))?.isInvalidated).toBe(false);
  });

  it('keeps pages intact while a rename refreshes rankings and transaction labels', () => {
    const queryClient = new QueryClient();
    const rankedPages = seedRankedPages(queryClient);
    queryClient.setQueryData(transactionKeys.all, []);
    const merchant = { ...zulu, name: 'Mike Store' };

    updateMerchantUpdateCaches(queryClient, merchant, { name: merchant.name });

    expect(queryClient.getQueryData(listKey)).toEqual(rankedPages);
    expect(queryClient.getQueryData(filteredKey)).toEqual({ pages: [[zulu]], pageParams: [0] });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(filteredKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(transactionKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(merchantKeys.detail(zulu.id))).toEqual(merchant);
  });
});
