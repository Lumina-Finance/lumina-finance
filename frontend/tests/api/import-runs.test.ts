/**
 * Covers what every import shares about a run: settling one kept from an interrupted save, and
 * reading the ledger again after a save that landed or whose outcome is unknown
 *
 * These tests catch regressions where a save that landed, with or without its answer, leaves the screens
 * showing the ledger as it was, and where a kept run is read as saved or dropped when it wasn't
 */
import { QueryClient, type MutationObserverOptions } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/auth/errors';
import { transactionKeys } from '@/api/cache/queryKeys';
import type { TransactionImportPayload } from '@/api/transaction-imports';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

const hookContext = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));

// Replace only the React entry points so the real observer runs the hook's mutation callbacks
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

import { settleStagedRun } from '@/api/import-runs';
import { useImportTransactions } from '@/api/transaction-imports';

const RUN_ID = 'run_1';

const PAYLOAD: TransactionImportPayload = {
  accounts: [{ source: 'Checking', create: { name: 'Checking', account_type: 'checking', currency: 'CAD' } }],
  categories: [{ source: 'Groceries', create: { name: 'Groceries', kind: 'expense' } }],
  merchants: [],
  rows: [{
    account_source: 'Checking',
    category_source: 'Groceries',
    dt: '2026-06-12',
    amount: '-42.50',
    merchant_name: 'Market',
    notes: '',
    tag_names: [],
  }],
};

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  hookContext.client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  hookContext.client.setQueryData(transactionKeys.list({}), []);
});

afterEach(() => {
  hookContext.client?.clear();
  hookContext.client = undefined;
});

/** Whether the transactions on screen were marked stale, so they are read again */
function isTransactionListStale() {
  return hookContext.client!.getQueryState(transactionKeys.list({}))?.isInvalidated;
}

describe('reading the ledger again after a save', () => {
  it('refreshes the transactions after a CSV save that landed', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ transactions_created: 1, accounts_created: 1, categories_created: 1 });

    await useImportTransactions().mutateAsync({ payload: PAYLOAD });

    expect(isTransactionListStale()).toBe(true);
  });

  it('refreshes the transactions after a CSV save whose answer was lost, since it may have landed', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await useImportTransactions().mutateAsync({ payload: PAYLOAD }).catch(() => undefined);

    expect(isTransactionListStale()).toBe(true);
  });

  it('leaves the transactions alone after a CSV upload that failed before saving', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(undefined);

    await useImportTransactions().mutateAsync({ payload: PAYLOAD }).catch(() => undefined);

    expect(isTransactionListStale()).toBe(false);
  });
});

describe('settling a kept run before importing afresh', () => {
  it.each([
    ['dropped', undefined, 'discarded'],
    ['already gone', new ApiError('Import run not found', 404, { detail: 'Import run not found' }), 'discarded'],
    ['committed after all', new ApiError('This import has already been committed', 409, { detail: 'This import has already been committed' }), 'saved'],
    ['held by a commit still running', new ApiError('This import is already being worked on', 409, { detail: 'This import is already being worked on' }), 'unsettled'],
    ['unanswered', new TypeError('Failed to fetch'), 'unsettled'],
  ])('reads a run that is %s', async (_case, failure, settlement) => {
    if (failure) authenticatedFetchMock.mockRejectedValueOnce(failure);
    else authenticatedFetchMock.mockResolvedValueOnce(undefined);

    expect(await settleStagedRun(RUN_ID)).toBe(settlement);
  });
});
