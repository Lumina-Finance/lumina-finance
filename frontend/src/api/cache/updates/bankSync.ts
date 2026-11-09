import type { InfiniteData, Query, QueryClient } from '@tanstack/react-query'
import {
  invalidateBankLinks,
  invalidateBankReview,
  invalidateBankReviewItems,
  invalidateBankSyncStatus,
  invalidateTransactions,
} from '@/api/cache/invalidation'
import { invalidateTargets } from '@/api/cache/invalidation/types'
import { bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys'
import {
  invalidateFinancialTransactionData,
  invalidatePatchedTransactionData,
  replaceCachedTransaction,
} from '@/api/cache/updates/transactions'
import type {
  AccountBankStatus,
  BankConnection,
  BankLink,
  BankReviewCounts,
  BankReviewItem,
  BankReviewPage,
  EditableBankField,
} from '@/api/bank-sync/types'
import type { Transaction } from '@/api/transactions/types'

type CachedReviewPages = InfiniteData<BankReviewPage, string | null>

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
  queryClient.setQueriesData<CachedReviewPages>({ queryKey: bankSyncKeys.reviewItemsAll }, (data) => {
    if (!data) return data
    return withoutReviewItems(data, isDecided, countByKind(data.pages.flatMap((page) => page.items).filter(isDecided)))
  })
}

function countByKind(items: BankReviewItem[]): BankReviewCounts {
  const counts: BankReviewCounts = { new: 0, correction: 0, removal: 0 }
  for (const item of items) counts[item.kind] += 1
  return counts
}

/** The pages without the decided items, each page's counts lowered by those given */
function withoutReviewItems(
  data: CachedReviewPages,
  isDecided: (item: BankReviewItem) => boolean,
  removed: BankReviewCounts,
): CachedReviewPages {
  if (removed.new + removed.correction + removed.removal === 0) return data

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
  }
}

/**
 * Refreshes everything a link made or removed changes, settling once the link list, the account
 * status, the connections and the providers have refetched, so a caller's toast lands with the
 * section that reads them rather than ahead of it
 */
export async function refreshBankLinkState(queryClient: QueryClient): Promise<void> {
  invalidateBankReview(queryClient)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.links(), exact: true, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.accountAll, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.connections(), exact: true, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.providers(), exact: true, refetchType: 'active' }),
  ])
}

/**
 * Puts a link the server answered with in place of the cached one, so the status shows what the
 * request did without waiting for the next poll. A list read before the link was made, such as on
 * another device, or restored from storage as the app opened, takes it last, as the server
 * lists the newest last, so the poll still follows it
 */
export function putCachedBankLink(queryClient: QueryClient, link: BankLink): void {
  queryClient.setQueryData<BankLink[]>(bankSyncKeys.links(), (links) => {
    if (!links) return links
    if (!links.some((cached) => cached.account_id === link.account_id)) return [...links, link]
    return links.map((cached) => (cached.account_id === link.account_id ? link : cached))
  })
}

/**
 * Puts a connection the server answered with in place of the cached one
 */
export function replaceCachedBankConnection(queryClient: QueryClient, connection: BankConnection): void {
  queryClient.setQueryData<BankConnection[]>(bankSyncKeys.connections(), (connections) =>
    connections?.map((cached) => (cached.id === connection.id ? connection : cached)),
  )
}

/**
 * Whether a link brought in data since it was last read: a sync that succeeded, or an import that
 * finished another part. Either can add review items and pending rows, and open a correction or
 * removal that ledger transactions show
 */
function hasNewBankData(previous: BankLink, link: BankLink): boolean {
  return (
    previous.sync.last_success_at !== link.sync.last_success_at ||
    previous.import?.windows_done !== link.import?.windows_done
  )
}

/**
 * Whether a link's review pause or warning came or went. The backlog notice shows them too. A stop
 * only the user can fix ends both without bringing in data
 */
function hasNewBacklogNotice(previous: BankLink, link: BankLink): boolean {
  return previous.sync.paused !== link.sync.paused || previous.sync.review_warning !== link.sync.review_warning
}

/**
 * Refreshes what a polled change in the link list makes stale
 *
 * Any change to a link refreshes the status shown for it and the pending strip, since a link moved to
 * Choose bank account, or removed, has its pending rows cleared without bringing in data. A pause or
 * warning that came or went refreshes the backlog notice. A link that brought in data also refreshes
 * the review inbox, the transaction lists and the account's figures. No other request would refresh
 * any of these, since the worker writes them outside any request this window made
 *
 * Nothing is compared until there is a list on both sides, so the first read is never taken as every
 * link appearing at once, and a list read again unchanged costs no comparison, since the cache hands
 * it back as the same array
 */
export function applyBankLinkChanges(
  queryClient: QueryClient,
  before: BankLink[] | undefined,
  after: BankLink[] | undefined,
): void {
  if (!before || !after || before === after) return

  const previousByAccount = new Map(before.map((link) => [link.account_id, link]))
  const withNewData: string[] = []
  let changed = before.length !== after.length
  let backlogNoticeChanged = false

  for (const link of after) {
    const previous = previousByAccount.get(link.account_id)
    if (!previous) {
      changed = true
      continue
    }
    if (JSON.stringify(previous) !== JSON.stringify(link)) changed = true
    if (hasNewBacklogNotice(previous, link)) backlogNoticeChanged = true
    if (hasNewBankData(previous, link)) withNewData.push(link.account_id)
  }

  if (!changed) return

  invalidateBankSyncStatus(queryClient)
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.pendingAll }, { queryKey: bankSyncKeys.holdsAll }])
  if (backlogNoticeChanged) invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.reviewBacklogsAll }])
  if (withNewData.length === 0) return

  invalidateBankReviewItems(queryClient)
  invalidateTransactions(queryClient)
  invalidateFinancialTransactionData(queryClient, withNewData)
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
  await refetchLedgerAndWaitingCounts(queryClient, accountIds)
  removeReviewItemsFromPages(queryClient, isDecided)
  invalidateBankSyncStatus(queryClient)
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.bulkPreviews }])
}

/**
 * Brings the ledger views and the inbox up to date after bulk approval
 *
 * The applied items leave the inbox once the transaction lists have refetched, as a single
 * decision's item does, so the block and the ledger show the approval in the same render. The scope
 * the preview covered lowers its counts by every applied item, loaded or not, and any other scope
 * cached from before takes out the items it holds. The inbox is then read again behind the scenes,
 * since an item the approval left waiting may have changed since the preview, and the returned
 * promise settles without waiting for it
 *
 * @param scope - The accounts the preview covered, as the block's list is read for them
 * @param applied - The previewed items the server applied
 */
export async function applyBulkApprovalOutcome(
  queryClient: QueryClient,
  scope: string[] | undefined,
  applied: BankReviewItem[],
): Promise<void> {
  const appliedIds = new Set(applied.map((item) => item.id))
  const isApplied = (item: BankReviewItem) => appliedIds.has(item.id)
  await refetchLedgerAndWaitingCounts(queryClient, [...new Set(applied.map((item) => item.account_id))])
  queryClient.setQueryData<CachedReviewPages>(
    bankSyncKeys.reviewItems(scope),
    (data) => data && withoutReviewItems(data, isApplied, countByKind(applied)),
  )
  removeReviewItemsFromPages(queryClient, isApplied)
  invalidateBankSyncStatus(queryClient)
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.reviewItemsAll }, { queryKey: bankSyncKeys.bulkPreviews }])
}

/**
 * Refreshes the ledger views of the accounts a review decision wrote to, settling once the
 * transaction lists, the links and the backlogs have refetched. The links and the backlogs carry the
 * waiting counts the sync status and the backlog notice read, so they refetch alongside, keeping the
 * notice in step with the block's count
 */
async function refetchLedgerAndWaitingCounts(queryClient: QueryClient, accountIds: string[]): Promise<void> {
  invalidateFinancialTransactionData(queryClient, accountIds)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: transactionKeys.all, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.links(), exact: true, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.reviewBacklogsAll, refetchType: 'active' }),
  ])
}

/**
 * Brings the inbox up to date after a review decision that left every ledger value as it was
 *
 * A kept transaction comes back with its bank source updated. That replaces the cached one so the
 * Needs review marker clears and the edited fields show without the lists refetching. The decided
 * items leave, and the marker clears, only once the links and the backlogs have refetched, since they
 * carry the waiting counts the sync status and the backlog notice read, so the notice never counts an
 * item the block no longer shows. The returned promise settles then
 *
 * Keeping a removal that took the place of a correction opens that correction again under the same
 * id. The kept transaction names that id as still waiting. That item stays, and the inbox is read again
 * before the promise settles, since the item now asks something else
 */
export async function applyReviewDecision(
  queryClient: QueryClient,
  isDecided: (item: BankReviewItem) => boolean,
  transaction: Transaction | undefined,
): Promise<void> {
  const stillWaitingId = transaction?.bank_source?.review_item_id ?? null
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.links(), exact: true, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: bankSyncKeys.reviewBacklogsAll, refetchType: 'active' }),
    stillWaitingId && queryClient.invalidateQueries({ queryKey: bankSyncKeys.reviewItemsAll, refetchType: 'active' }),
  ])
  if (transaction) replaceCachedTransaction(queryClient, transaction)
  removeReviewItemsFromPages(queryClient, (item) => isDecided(item) && item.id !== stillWaitingId)
  invalidateBankSyncStatus(queryClient)
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.bulkPreviews }])
}

/**
 * Brings the inbox up to date after a review decision the server refused. That most often means
 * the item changed since it was read: decided in another tab or on another device, or withdrawn by
 * the bank. The inbox, any bulk approval preview, and the backlogs and the link list that carry the
 * waiting counts are read again, so an item that no longer waits leaves the block
 */
export function applyRefusedReviewDecision(queryClient: QueryClient): void {
  invalidateBankReviewItems(queryClient)
  invalidateBankLinks(queryClient)
}

/**
 * Updates the views a restored bank date or amount changes
 *
 * The review inbox refetches too, since a waiting item shows its transaction's ledger date and
 * amount, and a restore settles that field of a waiting correction, closing one with nothing else
 * left. The link list stays, since its counts take in only new items
 */
export function applyRestoredBankValue(
  queryClient: QueryClient,
  transaction: Transaction,
  field: EditableBankField,
): void {
  replaceCachedTransaction(queryClient, transaction)
  invalidatePatchedTransactionData(
    queryClient,
    field === 'date' ? { dt: transaction.dt } : { amount: transaction.amount },
    [transaction.account_id],
  )
  invalidateBankReviewItems(queryClient)
}

/**
 * Updates the views an answer in the Bank link section changes that leaves the ledger as it was, such
 * as dismissing a reminder
 *
 * The account's bank link the server answered with takes the cached one's place, so what was answered
 * folds away straight away, or a newer reminder raised meanwhile shows, and the link list is read again, since it
 * holds the status and the reminders too
 */
export function applyAccountBankStatus(queryClient: QueryClient, status: AccountBankStatus): void {
  queryClient.setQueryData(bankSyncKeys.accountStatus(status.account_id), status)
  invalidateBankLinks(queryClient)
}

/**
 * Updates the views an answer to the opening adjustment offer changes
 *
 * The offer folds away as any answer's does. A recorded adjustment is a new ledger transaction. The
 * transaction lists and the account's figures take it in, and Difference with them
 */
export function applyOpeningAdjustmentAnswer(
  queryClient: QueryClient,
  status: AccountBankStatus,
  recorded: boolean,
): void {
  applyAccountBankStatus(queryClient, status)
  if (!recorded) return
  invalidateTransactions(queryClient)
  invalidateFinancialTransactionData(queryClient, [status.account_id])
}

/**
 * Whether a bank sync query asks about the account, on its own or among others
 */
function asksAboutAccount(query: Query, accountId: string): boolean {
  return query.queryKey.some((part) => part === accountId || (Array.isArray(part) && part.includes(accountId)))
}

/**
 * Whether a bank sync query asks about the account, holds data naming it, or is being read and may
 * come back naming it
 */
function mayNameAccount(query: Query, accountId: string): boolean {
  return (
    asksAboutAccount(query, accountId) ||
    query.state.fetchStatus === 'fetching' ||
    (JSON.stringify(query.state.data) ?? '').includes(`"${accountId}"`)
  )
}

/**
 * Drops bank data that belonged to a deleted account. The server deleted the account's link, waiting
 * items and pending rows with it. A cached bulk preview is dropped rather than refetched, since it would
 * list the deleted account's items until it did
 *
 * The rest of bank sync is read again only when some of it names the account. A link going can
 * change what no view names it in, such as the institutions in use, while an account bank sync never
 * knew of, as every account is for a user without bank sync, changes nothing there
 *
 * The account's own bank views go now only if nothing shows them. Its page keeps showing them while
 * it animates out, and asking about the account again would be answered not found, so the page
 * forgets the rest as it leaves (forgetDeletedAccountBankData)
 */
export function clearDeletedAccountBankData(queryClient: QueryClient, accountId: string): void {
  queryClient.removeQueries({ queryKey: bankSyncKeys.bulkPreviews })
  const cached = queryClient.getQueryCache().findAll({ queryKey: bankSyncKeys.all })
  if (!cached.some((query) => mayNameAccount(query, accountId))) return
  queryClient.removeQueries({
    queryKey: bankSyncKeys.all,
    type: 'inactive',
    predicate: (query) => asksAboutAccount(query, accountId),
  })
  queryClient.invalidateQueries({
    queryKey: bankSyncKeys.all,
    refetchType: 'active',
    predicate: (query) => !asksAboutAccount(query, accountId),
  })
}

/**
 * Forgets a deleted account's bank views, for its page to call once it is no longer on screen
 */
export function forgetDeletedAccountBankData(queryClient: QueryClient, accountId: string): void {
  queryClient.removeQueries({ queryKey: bankSyncKeys.all, predicate: (query) => asksAboutAccount(query, accountId) })
}
