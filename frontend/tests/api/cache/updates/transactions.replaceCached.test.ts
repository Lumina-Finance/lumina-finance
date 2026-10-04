/**
 * Covers putting the server's copy of a transaction in place of the cached one
 *
 * These tests catch a review decision that only clears a transaction's Needs review marker updating
 * one cached view and leaving another showing the marker, or a list that never held the transaction
 * being rewritten
 */
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { transactionKeys } from '@/api/cache/queryKeys';
import { replaceCachedTransaction } from '@/api/cache/updates/transactions';
import type { Transaction } from '@/api/transactions/types';
import { createBankTransaction } from './fixtures';

const waiting = createBankTransaction('bank-expense', 'item-1');
const kept = createBankTransaction('bank-expense');
const other: Transaction = { ...createBankTransaction('hand-entered'), bank_source: null };

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
});

describe('replacing a cached transaction', () => {
  it('replaces it in paged lists, plain lists and its detail', () => {
    const pagedKey = transactionKeys.infinite({}, 2);
    queryClient.setQueryData<InfiniteData<Transaction[]>>(pagedKey, { pages: [[other], [waiting]], pageParams: [0, 1] });
    queryClient.setQueryData(transactionKeys.list({}), [waiting, other]);
    queryClient.setQueryData(transactionKeys.detail(waiting.id), waiting);

    replaceCachedTransaction(queryClient, kept);

    expect(queryClient.getQueryData<InfiniteData<Transaction[]>>(pagedKey)?.pages).toEqual([[other], [kept]]);
    expect(queryClient.getQueryData(transactionKeys.list({}))).toEqual([kept, other]);
    expect(queryClient.getQueryData(transactionKeys.detail(waiting.id))).toEqual(kept);
  });

  it('leaves lists and details that never held it as they were', () => {
    const otherList = [other];
    queryClient.setQueryData(transactionKeys.list({ account_id: 'account-2' }), otherList);
    queryClient.setQueryData(transactionKeys.detail(other.id), other);

    replaceCachedTransaction(queryClient, kept);

    expect(queryClient.getQueryData(transactionKeys.list({ account_id: 'account-2' }))).toBe(otherList);
    expect(queryClient.getQueryData(transactionKeys.detail(other.id))).toBe(other);
    expect(queryClient.getQueryData(transactionKeys.detail(kept.id))).toBeUndefined();
  });
});
