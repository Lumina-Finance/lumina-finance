import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { AccountSpendingBreakdown, SpendingRange } from '@/api/accounts/types';
import { accountKeys, insightsKeys, transactionKeys } from '@/api/cache/queryKeys';
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
const ACCOUNT_IDS = ['source', 'destination', 'unrelated'];
const SPENDING_RANGES: SpendingRange[] = ['MTD', 'YTD'];
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

/** Seeds fresh merchant summaries and account spending across periods and account scopes */
function seedCache() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: STALE_TIME_MS, retry: false } } });
  clients.push(client);
  for (const key of MERCHANT_QUERY_KEYS) client.setQueryData(key, createMerchantSummary());
  client.setQueryData(accountKeys.list(), []);
  client.setQueryData(transactionKeys.list({}), []);
  for (const accountId of ACCOUNT_IDS) {
    client.setQueryData(accountKeys.cashFlow(accountId, 3), []);
    client.setQueryData(accountKeys.cashFlow(accountId, 12), []);
    for (const range of SPENDING_RANGES) {
      client.setQueryData<AccountSpendingBreakdown>(accountKeys.spendingBreakdown(accountId, range), {
        range,
        top_categories: [{ category_id: 'groceries', name: 'Groceries', total: 10000 }],
        top_merchants: [{ merchant_id: 'costco', name: 'Costco', total: 10000 }],
        categories_total_spend: 10000,
        merchants_total_spend: 10000,
        other_categories_count: 0,
        other_merchants_count: 0,
      });
    }
  }
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
  it('refreshes merchant spending only for affected accounts after merchant reassignment', () => {
    const client = seedCache();
    const accountIds = ['source', 'destination'];

    if (mode === 'single') {
      invalidatePatchedTransactionData(client, { merchant_id: 'walmart' }, accountIds);
    } else {
      invalidateBulkUpdatedTransactionData(client, { transaction_ids: ['txn_1', 'txn_2'], merchant_id: 'walmart' }, accountIds);
    }

    for (const accountId of ACCOUNT_IDS) {
      expect(client.getQueryState(accountKeys.cashFlow(accountId, 3))?.isInvalidated).toBe(false);
      expect(client.getQueryState(accountKeys.cashFlow(accountId, 12))?.isInvalidated).toBe(false);
      for (const range of SPENDING_RANGES) {
        const key = accountKeys.spendingBreakdown(accountId, range);
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(accountId !== 'unrelated');
      }
    }
    expect(client.getQueryState(accountKeys.list())?.isInvalidated).toBe(false);
  });

  it('still refreshes cash flow when a merchant edit also changes the date', () => {
    const client = seedCache();
    const patch = { merchant_id: 'walmart', dt: '2026-08-31' };

    if (mode === 'single') {
      invalidatePatchedTransactionData(client, patch, ['source']);
    } else {
      invalidateBulkUpdatedTransactionData(client, { transaction_ids: ['txn_1'], ...patch }, ['source']);
    }

    expect(client.getQueryState(accountKeys.cashFlow('source', 3))?.isInvalidated).toBe(true);
    expect(client.getQueryState(accountKeys.spendingBreakdown('source', 'MTD'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(accountKeys.cashFlow('unrelated', 3))?.isInvalidated).toBe(false);
  });

  it.each(['notes', 'tags'] as const)('keeps merchant summaries and account spending fresh for a %s-only edit', (field) => {
    const client = seedCache();

    if (mode === 'single') {
      const patch = field === 'notes' ? { notes: 'Corrected' } : { tag_ids: ['tag_1'] };
      invalidatePatchedTransactionData(client, patch, ['source']);
    } else {
      const fields = field === 'notes' ? { notes: 'Corrected' } : { add_tag_ids: ['tag_1'] };
      invalidateBulkUpdatedTransactionData(client, { transaction_ids: ['txn_1'], ...fields }, ['source']);
    }

    for (const key of MERCHANT_QUERY_KEYS) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    for (const accountId of ACCOUNT_IDS) {
      for (const range of SPENDING_RANGES) {
        expect(client.getQueryState(accountKeys.spendingBreakdown(accountId, range))?.isInvalidated).toBe(false);
      }
    }
    expect(client.getQueryState(transactionKeys.list({}))?.isInvalidated).toBe(true);
  });
});
