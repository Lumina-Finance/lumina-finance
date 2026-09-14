import {
  QueryClient,
  type InfiniteData,
  type MutationObserverOptions,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from '@/api/config';
import { registerAuthBindings } from '@/api/client';
import { accountKeys, transactionKeys } from '@/api/cache/queryKeys';
import { findCachedTransaction } from '@/api/cache/updates/transactions';
import { applyTransactionDeletion, useDeleteTransaction, useUpdateTransaction } from '@/api/transactions/hooks';
import type { Transaction } from '@/api/transactions/types';

const hookContext = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));

// Replace only the React entry points so the real observer executes the hook's mutation callbacks
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => hookContext.client,
    useMutation: <TData, TError, TVariables, TContext>(
      options: MutationObserverOptions<TData, TError, TVariables, TContext>,
    ) => {
      const observer = new actual.MutationObserver(hookContext.client!, options);
      return { mutateAsync: (variables: TVariables) => observer.mutate(variables) };
    },
  };
});

const fetchMock = vi.fn();
const target: Transaction = {
  id: 'older-expense', created_by_user_id: 'test-user', account_id: 'source',
  dt: '2026-09-01', merchant_id: 'merchant', merchant_name: 'Test merchant',
  category_id: 'expense', amount: -10000, account_amount: null, base_currency_amount: null,
  currency: 'CAD', fx_rate: null, notes: 'Older large expense',
  counterparty_account_id: null, counterparty_account_scope: null,
  created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z', tag_ids: [], tags: [],
};
const other: Transaction = { ...target, id: 'newer-expense', amount: -100, dt: '2026-09-14' };

beforeEach(() => {
  hookContext.client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  registerAuthBindings({ getAccessToken: () => 'test-token', onSessionRefreshed: vi.fn(), onSessionLost: vi.fn() });
});

afterEach(() => {
  hookContext.client?.clear();
  hookContext.client = undefined;
  vi.unstubAllGlobals();
});

/** Seeds separate account views so a mutation must refresh only its affected accounts */
function seedAccountViews(client: QueryClient): void {
  for (const id of ['source', 'destination', 'unrelated']) {
    client.setQueryData(accountKeys.detail(id), { id, account_kind: 'asset', tax_advantaged_category_id: null });
    client.setQueryData(accountKeys.cashFlow(id, 3), []);
    client.setQueryData(accountKeys.spendingBreakdown(id, 'MTD'), {});
  }
}

/** Checks account detail, cash flow and spending freshness without mocking invalidation */
function expectAccountInvalidation(client: QueryClient, id: string, invalidated: boolean): void {
  for (const key of [accountKeys.detail(id), accountKeys.cashFlow(id, 3), accountKeys.spendingBreakdown(id, 'MTD')]) {
    expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated);
  }
}

describe('transaction lookup across cached response shapes', () => {
  it('finds a transaction cached only as a detail response', () => {
    const client = hookContext.client!;
    client.setQueryData(transactionKeys.detail(target.id), target);
    expect(findCachedTransaction(client, target.id)).toEqual(target);
  });

  it.each(['plain', 'infinite'] as const)('skips an unrelated detail before a matching %s list', (shape) => {
    const client = hookContext.client!;
    client.setQueryData(transactionKeys.detail(other.id), other);
    if (shape === 'plain') {
      client.setQueryData(transactionKeys.list({}), [target]);
    } else {
      client.setQueryData<InfiniteData<Transaction[]>>(transactionKeys.infinite({}, 1), {
        pages: [[other], [target]], pageParams: [0, 1],
      });
    }
    expect(findCachedTransaction(client, target.id)).toEqual(target);
  });

  it.each(['empty', 'unrelated detail', 'empty lists'] as const)('returns no match for %s', (shape) => {
    const client = hookContext.client!;
    if (shape === 'unrelated detail') client.setQueryData(transactionKeys.detail(other.id), other);
    if (shape === 'empty lists') {
      client.setQueryData(transactionKeys.list({}), []);
      client.setQueryData(transactionKeys.infinite({}, 15), { pages: [[], []], pageParams: [0, 15] });
    }
    expect(findCachedTransaction(client, target.id)).toBeUndefined();
  });

  it('preserves the existing cache scan order when multiple responses contain a transaction', () => {
    const client = hookContext.client!;
    client.setQueryData(transactionKeys.list({}), [target]);
    client.setQueryData(transactionKeys.detail(target.id), { ...target, notes: 'Later cached detail' });
    expect(findCachedTransaction(client, target.id)).toEqual(target);
  });
});

describe('mutations after loading a transaction detail', () => {
  it('sends a detail-only account move and refreshes the old and new accounts', async () => {
    const client = hookContext.client!;
    seedAccountViews(client);
    client.setQueryData(transactionKeys.detail(target.id), target);
    const updated = { ...target, account_id: 'destination' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(updated)));

    await expect(useUpdateTransaction().mutateAsync({
      id: target.id, patch: { account_id: 'destination' },
    })).resolves.toEqual(updated);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/transactions/${target.id}`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ account_id: 'destination' }),
    }));
    expectAccountInvalidation(client, 'source', true);
    expectAccountInvalidation(client, 'destination', true);
    expectAccountInvalidation(client, 'unrelated', false);
    expect(client.getQueryState(transactionKeys.detail(target.id))?.isInvalidated).toBe(true);
  });

  it.each([false, true])('deletes a detail-backed transaction with deferred removal=%s', async (deferRemoval) => {
    const client = hookContext.client!;
    seedAccountViews(client);
    client.setQueryData(transactionKeys.detail(target.id), target);
    client.setQueryData(transactionKeys.list({}), [target, other]);
    client.setQueryData<InfiniteData<Transaction[]>>(transactionKeys.infinite({}, 1), {
      pages: [[other], [target]], pageParams: [0, 1],
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await useDeleteTransaction({ deferRemoval }).mutateAsync(target.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/transactions/${target.id}`, expect.objectContaining({ method: 'DELETE' }));
    if (deferRemoval) {
      expect(client.getQueryData(transactionKeys.list({}))).toEqual([target, other]);
      expect(client.getQueryState(transactionKeys.detail(target.id))?.isInvalidated).toBe(false);
      expectAccountInvalidation(client, 'source', false);
      applyTransactionDeletion(client, target.id, target.account_id);
    }

    expect(client.getQueryData(transactionKeys.list({}))).toEqual([other]);
    expect(client.getQueryData(transactionKeys.infinite({}, 1))).toEqual({ pages: [[other], []], pageParams: [0, 1] });
    expect(client.getQueryState(transactionKeys.detail(target.id))?.isInvalidated).toBe(true);
    expectAccountInvalidation(client, 'source', true);
    expectAccountInvalidation(client, 'destination', false);
    expectAccountInvalidation(client, 'unrelated', false);
  });
});
