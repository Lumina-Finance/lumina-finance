/**
 * Covers what happens to the import step's payee answers when a merchant is created elsewhere
 *
 * The answer says which of a file's payee values have no merchant yet, so a merchant made while it
 * is cached would otherwise leave the step offering to create one that now exists
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { merchantKeys } from '@/api/cache/queryKeys';
import { updateMerchantCreateCaches } from '@/api/cache/updates/merchants';
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
