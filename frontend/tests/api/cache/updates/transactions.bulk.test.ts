/**
 * Tests which cached views a bulk transaction edit refreshes
 *
 * useBulkUpdateTransactions calls useMutation and useQueryClient, which need a live React tree to
 * invoke, so this covers invalidateBulkUpdatedTransactionData directly against a real QueryClient
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { budgetKeys, transactionKeys } from '@/api/cache/queryKeys';
import { invalidateBulkUpdatedTransactionData } from '@/api/cache/updates/transactions';

/**
 * Seeds the two query families these tests read back, so each one exists to be marked stale
 */
function seedCache() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(transactionKeys.list({}), []);
  queryClient.setQueryData(budgetKeys.latestUtilizations(), []);
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
});
