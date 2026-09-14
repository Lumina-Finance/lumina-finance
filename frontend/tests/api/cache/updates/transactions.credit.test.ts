import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountKind } from '@/api/accounts/types';
import { accountKeys, dashboardKeys } from '@/api/cache/queryKeys';
import {
  invalidateFinancialTransactionData,
  invalidateTransactionAccountData,
} from '@/api/cache/updates/transactions';
import type { CreditWidgetResponse } from '@/api/dashboard/types';
import { getFxAwareStaleTime } from '@/api/shared/fxCache';

// Match the credit widget's normal freshness window so expiry cannot cause the expected refetch
const CREDIT_STALE_TIME_MS = 10 * 60 * 1000;
const clients: QueryClient[] = [];

/** Represents a complete CAD credit summary in minor units */
function creditSummary(used: number): CreditWidgetResponse {
  return { credit_limit_total: 50000, credit_used: used, fx_status: { state: 'complete', missing_pairs: [] } };
}

/** Seeds fresh credit data before a deferred transaction creation completes */
function createClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: CREDIT_STALE_TIME_MS, retry: false } } });
  client.setQueryData(dashboardKeys.credit(), creditSummary(10000));
  clients.push(client);
  return client;
}

/** Supplies the account kind from either cache shape consulted by credit invalidation */
function seedKind(client: QueryClient, source: 'detail' | 'list', kind: AccountKind): void {
  const account = { id: 'credit', account_kind: kind, tax_advantaged_category_id: null };
  client.setQueryData(source === 'detail' ? accountKeys.detail('credit') : accountKeys.list(), source === 'detail' ? account : [account]);
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe('credit usage after deferred transaction creation', () => {
  it('waits for the deferred flush, then refreshes active credit from 100 to 150', async () => {
    const client = createClient();
    seedKind(client, 'detail', 'revolving');
    const queryFn = vi.fn().mockResolvedValue(creditSummary(15000));
    const observer = new QueryObserver(client, {
      queryKey: dashboardKeys.credit(), queryFn, staleTime: getFxAwareStaleTime(CREDIT_STALE_TIME_MS),
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      invalidateFinancialTransactionData(client, ['credit'], {
        deferAccountInvalidation: true, deferTransactionOverview: true,
      });
      expect(observer.getCurrentResult().data).toEqual(creditSummary(10000));
      expect(client.getQueryState(dashboardKeys.credit())?.isInvalidated).toBe(false);
      expect(queryFn).not.toHaveBeenCalled();

      invalidateTransactionAccountData(client, ['credit'], { refetchAccountList: true });

      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(creditSummary(15000)));
      expect(queryFn).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('invalidates inactive credit so the next dashboard mount fetches current usage', async () => {
    const client = createClient();
    seedKind(client, 'list', 'revolving');
    const queryFn = vi.fn().mockResolvedValue(creditSummary(15000));

    invalidateTransactionAccountData(client, ['credit'], { refetchAccountList: true });

    expect(client.getQueryState(dashboardKeys.credit())?.isInvalidated).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
    const observer = new QueryObserver(client, {
      queryKey: dashboardKeys.credit(), queryFn, staleTime: getFxAwareStaleTime(CREDIT_STALE_TIME_MS),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(creditSummary(15000)));
      expect(queryFn).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it.each(['detail', 'list'] as const)('refreshes credit only for revolving kinds found in the %s cache', (source) => {
    for (const kind of ['asset', 'amortizing', 'revolving'] as const) {
      const client = createClient();
      seedKind(client, source, kind);

      invalidateTransactionAccountData(client, ['credit'], { refetchAccountList: true });

      expect(client.getQueryState(dashboardKeys.credit())?.isInvalidated, kind).toBe(kind === 'revolving');
    }
  });

  it('refreshes credit when the changed account kind is not cached', () => {
    const client = createClient();
    client.setQueryData(accountKeys.list(), [{ id: 'unrelated', account_kind: 'asset' }]);

    invalidateTransactionAccountData(client, ['unknown'], { refetchAccountList: true });

    expect(client.getQueryState(dashboardKeys.credit())?.isInvalidated).toBe(true);
  });

  it('makes one credit request for a flush containing mixed and repeated account IDs', async () => {
    const client = createClient();
    client.setQueryData(accountKeys.list(), [
      { id: 'asset', account_kind: 'asset' },
      { id: 'credit', account_kind: 'revolving' },
      { id: 'loan', account_kind: 'amortizing' },
    ]);
    const queryFn = vi.fn().mockResolvedValue(creditSummary(15000));
    const observer = new QueryObserver(client, {
      queryKey: dashboardKeys.credit(), queryFn, staleTime: getFxAwareStaleTime(CREDIT_STALE_TIME_MS),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(queryFn).not.toHaveBeenCalled();
      invalidateTransactionAccountData(client, ['asset', 'credit', 'credit', 'loan'], { refetchAccountList: true });
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(creditSummary(15000)));
      expect(queryFn).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
