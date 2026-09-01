/**
 * Tests which cached views a bulk transaction edit refreshes
 *
 * useBulkUpdateTransactions calls useMutation and useQueryClient, which need a live React tree to
 * invoke, so this covers invalidateBulkUpdatedTransactionData directly against a real QueryClient
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { accountKeys, budgetKeys, transactionKeys } from '@/api/cache/queryKeys';
import { invalidateBulkUpdatedTransactionData } from '@/api/cache/updates/transactions';

/**
 * Seeds the two query families these tests read back, so each one exists to be marked stale
 */
function seedCache() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(transactionKeys.list({}), []);
  queryClient.setQueryData(budgetKeys.latestUtilizations(), []);
  queryClient.setQueryData(accountKeys.list(), []);
  return queryClient;
}

function isStale(queryClient: QueryClient, queryKey: readonly unknown[]) {
  return queryClient.getQueryCache().find({ queryKey })?.state.isInvalidated === true;
}

describe('invalidateBulkUpdatedTransactionData', () => {
  it('refreshes the transaction lists after a tags-only edit', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], add_tag_ids: ['tag_1'] },
      ['acc_1'],
    );

    expect(isStale(queryClient, transactionKeys.list({}))).toBe(true);
  });

  it('leaves the budget totals alone after a tags-only edit', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], add_tag_ids: ['tag_1'] },
      ['acc_1'],
    );

    expect(isStale(queryClient, budgetKeys.latestUtilizations())).toBe(false);
  });

  it('refreshes the budget totals after a category edit', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], category_id: 'cat_1' },
      ['acc_1'],
    );

    expect(isStale(queryClient, budgetKeys.latestUtilizations())).toBe(true);
    expect(isStale(queryClient, transactionKeys.list({}))).toBe(true);
  });

  it('refreshes the account balances after a move', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], account_id: 'acc_2' },
      ['acc_1', 'acc_2'],
    );

    expect(isStale(queryClient, accountKeys.list())).toBe(true);
  });

  it('refreshes the account balances after a date change', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], dt: '2026-08-14' },
      ['acc_1'],
    );

    expect(isStale(queryClient, accountKeys.list())).toBe(true);
  });

  it('leaves the account balances alone after a note edit', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], notes: 'Corrected' },
      ['acc_1'],
    );

    expect(isStale(queryClient, accountKeys.list())).toBe(false);
    expect(isStale(queryClient, transactionKeys.list({}))).toBe(true);
  });

  it('refreshes the account balances after a direction change', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], direction: 'reverse' },
      ['acc_1'],
    );

    expect(isStale(queryClient, accountKeys.list())).toBe(true);
  });

  it('refreshes the account balances after a transfer end is set', () => {
    const queryClient = seedCache();

    invalidateBulkUpdatedTransactionData(
      queryClient,
      { transaction_ids: ['txn_1'], transfer_from: { scope: 'tracked', account_id: 'acc_2' } },
      ['acc_1', 'acc_2'],
    );

    expect(isStale(queryClient, accountKeys.list())).toBe(true);
  });
});
