import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { insightsKeys, transactionKeys } from '@/api/cache/queryKeys';
import {
  invalidateBulkUpdatedTransactionData,
  invalidatePatchedTransactionData,
} from '@/api/cache/updates/transactions';
import type { InsightsMerchantsResponse } from '@/api/insights/types';
import type { BulkUpdateTransactionsPayload, UpdateTransactionPayload } from '@/api/transactions/types';

// Match the normal five-minute insights cache lifetime so immediate refreshes require invalidation
const STALE_TIME_MS = 5 * 60 * 1000;
const MERCHANT_QUERY_KEYS = [
  insightsKeys.merchants('2026-09-01', '2026-09-30'),
  insightsKeys.merchants('2026-08-01', '2026-08-31'),
  insightsKeys.merchants('2026-09-01', '2026-09-30', 'previous_year'),
];
const clients: QueryClient[] = [];

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

/** Creates the combined distribution and ranking response using CAD minor units */
function createMerchantSummary(amount = 10000): InsightsMerchantsResponse {
  return {
    distribution: [['costco', 'Costco', amount, null, null]],
    ranking: [['costco', 'Costco', amount, 1, null]],
    fx_status: { state: 'complete', missing_pairs: [] },
  };
}

/** Seeds fresh merchant summaries across periods and comparison ranges */
function seedCache() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: STALE_TIME_MS, retry: false } } });
  clients.push(client);
  for (const key of MERCHANT_QUERY_KEYS) client.setQueryData(key, createMerchantSummary());
  client.setQueryData(transactionKeys.list({}), []);
  return client;
}

describe('merchant spending after single transaction edits', () => {
  it.each([
    { name: 'changing the expense amount', patch: { amount: -20000 } },
    { name: 'changing the amount to a refund', patch: { amount: 20000 } },
    { name: 'setting the amount to zero', patch: { amount: 0 } },
    { name: 'moving the date into another month', patch: { dt: '2026-08-31' } },
    { name: 'moving the transaction to another account', patch: { account_id: 'destination' } },
    { name: 'changing the category', patch: { category_id: 'other-expense' } },
    { name: 'reassigning the merchant', patch: { merchant_id: 'walmart' } },
    { name: 'removing the merchant', patch: { merchant_id: null } },
  ] satisfies { name: string; patch: UpdateTransactionPayload }[])(
    'invalidates every cached merchant period after $name',
    ({ patch }) => {
      const client = seedCache();

      invalidatePatchedTransactionData(client, patch, ['source', 'destination']);

      for (const key of MERCHANT_QUERY_KEYS) {
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
      }
    },
  );

  it('refetches active merchant spending from $100 to $200 without waiting for the cache to expire', async () => {
    const client = seedCache();
    const queryKey = MERCHANT_QUERY_KEYS[0];
    const queryFn = vi.fn().mockResolvedValue(createMerchantSummary(20000));
    const observer = new QueryObserver(client, { queryKey, queryFn });
    const unsubscribe = observer.subscribe(() => {});

    try {
      expect(queryFn).not.toHaveBeenCalled();
      expect(observer.getCurrentResult().data).toEqual(createMerchantSummary(10000));

      invalidatePatchedTransactionData(client, { amount: -20000 }, ['source']);

      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data).toEqual(createMerchantSummary(20000));
      });
      expect(queryFn).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});

describe('merchant spending after bulk transaction edits', () => {
  it.each([
    { name: 'date change', fields: { dt: '2026-08-31' } },
    { name: 'account move', fields: { account_id: 'destination' } },
    { name: 'category change', fields: { category_id: 'other-expense' } },
    { name: 'merchant reassignment', fields: { merchant_id: 'walmart' } },
    { name: 'direction reversal', fields: { direction: 'reverse' } },
    { name: 'transfer direction reversal', fields: { transfer_direction: 'reverse' } },
    { name: 'transfer source change', fields: { transfer_from: { scope: 'tracked', account_id: 'destination' } } },
    { name: 'transfer destination change', fields: { transfer_to: { scope: 'outside' } } },
  ] satisfies { name: string; fields: Omit<BulkUpdateTransactionsPayload, 'transaction_ids'> }[])(
    'invalidates every cached merchant period after a bulk $name',
    ({ fields }) => {
      const client = seedCache();

      invalidateBulkUpdatedTransactionData(client, { transaction_ids: ['txn_1', 'txn_2'], ...fields }, ['source', 'destination']);

      for (const key of MERCHANT_QUERY_KEYS) {
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
      }
    },
  );
});

describe.each(['single', 'bulk'] as const)('%s transaction edit scope', (mode) => {
  it.each(['notes', 'tags'] as const)('keeps merchant summaries fresh for a %s-only edit', (field) => {
    const client = seedCache();

    if (mode === 'single') {
      const patch = field === 'notes' ? { notes: 'Corrected' } : { tag_ids: ['tag_1'] };
      invalidatePatchedTransactionData(client, patch, ['source']);
    } else {
      const fields = field === 'notes' ? { notes: 'Corrected' } : { add_tag_ids: ['tag_1'] };
      invalidateBulkUpdatedTransactionData(client, { transaction_ids: ['txn_1'], ...fields }, ['source']);
    }

    for (const key of MERCHANT_QUERY_KEYS) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryState(transactionKeys.list({}))?.isInvalidated).toBe(true);
  });
});
