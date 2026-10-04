import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  invalidateBankLinks,
  invalidateBankReview,
  invalidateBankSyncStatus,
  invalidateTransactions,
} from '@/api/cache/invalidation';
import { invalidateTargets } from '@/api/cache/invalidation/types';
import { bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys';
import {
  invalidateFinancialTransactionData,
  invalidatePatchedTransactionData,
  replaceCachedTransaction,
} from '@/api/cache/updates/transactions';
import type {
  BankLink,
  BankReviewCounts,
  BankReviewItem,
  BankReviewPage,
  EditableBankField,
} from '@/api/bank-sync/types';
import type { Transaction } from '@/api/transactions/types';

type CachedReviewPages = InfiniteData<BankReviewPage, string | null>;

/**
 * Takes decided items out of every cached page of the review inbox at once, and out of its counts
 *
 * The block shows the decision straight away rather than when the list next refetches, and the
 * pages after them stay where they are, since each is read from a cursor rather than an offset
 */
export function removeReviewItemsFromPages(
  queryClient: QueryClient,
  isDecided: (item: BankReviewItem) => boolean,
): void {
  queryClient.setQueriesData<CachedReviewPages>({ queryKey: bankSyncKeys.reviewAll }, (data) => {
    if (!data) return data;

    const removed: BankReviewCounts = { new: 0, correction: 0, removal: 0 };
    for (const item of data.pages.flatMap((page) => page.items)) {
      if (isDecided(item)) removed[item.kind] += 1;
    }
    if (removed.new + removed.correction + removed.removal === 0) return data;

    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => !isDecided(item)),
        counts: {
          new: Math.max(0, page.counts.new - removed.new),
          correction: Math.max(0, page.counts.correction - removed.correction),
          removal: Math.max(0, page.counts.removal - removed.removal),
        },
      })),
    };
  });
}

/**
 * Refreshes everything a link made or removed changes, settling once the link list, the account
 * status, the connections and the providers have refetched, so a caller's toast lands with the
 * section that reads them rather than ahead of it
 */
export async function refreshBankLinkState(queryClient: QueryClient): Promise<void> {
  invalidateBankReview(queryClient);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.links(), exact: true, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.accountAll, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.connections(), exact: true, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.providers(), exact: true, refetchType: 'active' }),
  ]);
}

/**
 * Whether a link brought in data since it was last read: a sync that succeeded, or an import that
 * finished another part. Either can add review items, pending rows and, where a kind of change is
 * trusted, ledger transactions
 */
function hasNewBankData(previous: BankLink, link: BankLink): boolean {
  return previous.last_success_at !== link.last_success_at
    || previous.import?.windows_done !== link.import?.windows_done;
}

/**
 * Refreshes what a polled change in the link list makes stale
 *
 * Any change to a link refreshes the status shown for it. A link that brought in data refreshes the
 * review inbox, the pending strip, the transaction lists and the account's figures, which no other
 * request would, since the worker writes them outside any request this window made
 */
export function applyBankLinkChanges(queryClient: QueryClient, before: BankLink[], after: BankLink[]): void {
  const previousByAccount = new Map(before.map((link) => [link.account_id, link]));
  const withNewData: string[] = [];
  let changed = before.length !== after.length;

  for (const link of after) {
    const previous = previousByAccount.get(link.account_id);
    if (!previous) {
      changed = true;
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(link)) changed = true;
    if (hasNewBankData(previous, link)) withNewData.push(link.account_id);
  }

  if (changed) invalidateBankSyncStatus(queryClient);
  if (withNewData.length === 0) return;

  invalidateBankReview(queryClient);
  invalidateTransactions(queryClient);
  invalidateFinancialTransactionData(queryClient, withNewData);
}

/**
 * Brings the ledger views and the inbox up to date after a review decision that wrote to the ledger
 *
 * The decided items leave the inbox only once the transaction lists have refetched, so an item never
 * vanishes from the block before its transaction shows in the list. The returned promise settles
 * then, so a caller's toast lands with both
 */
export async function applyLedgerReviewOutcome(
  queryClient: QueryClient,
  accountIds: string[],
  isDecided: (item: BankReviewItem) => boolean,
): Promise<void> {
  invalidateFinancialTransactionData(queryClient, accountIds);

  // The links carry the waiting counts the backlog notice reads, so they refetch alongside, keeping
  // the notice in step with the block's count
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: transactionKeys.all, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.links(), exact: true, refetchType: 'active' }),
  ]);
  removeReviewItemsFromPages(queryClient, isDecided);
  invalidateBankSyncStatus(queryClient);
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.bulkPreviews }]);
}

/**
 * Brings the inbox up to date after a review decision that left every ledger value as it was
 *
 * A kept transaction comes back with its bank source updated, which replaces the cached one so the
 * Needs review marker clears and the edited fields show without the lists refetching
 */
export function applyReviewDecision(
  queryClient: QueryClient,
  isDecided: (item: BankReviewItem) => boolean,
  transaction: Transaction | undefined,
): void {
  if (transaction) replaceCachedTransaction(queryClient, transaction);
  removeReviewItemsFromPages(queryClient, isDecided);
  invalidateBankLinks(queryClient);
  invalidateBankSyncStatus(queryClient);
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.bulkPreviews }]);
}

/**
 * Updates the views a restored bank date or amount changes
 */
export function applyRestoredBankValue(
  queryClient: QueryClient,
  transaction: Transaction,
  field: EditableBankField,
): void {
  replaceCachedTransaction(queryClient, transaction);
  invalidatePatchedTransactionData(
    queryClient,
    field === 'date' ? { dt: transaction.dt } : { amount: transaction.amount },
    [transaction.account_id],
  );
}

/**
 * Drops bank data that belonged to a deleted account, whose link, waiting items and pending rows the
 * server deleted with it. A cached bulk preview is dropped rather than refetched, since it would
 * list the deleted account's items until it did
 */
export function clearDeletedAccountBankData(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: bankSyncKeys.bulkPreviews });
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.all }]);
}
