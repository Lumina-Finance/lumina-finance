import type { QueryClient } from '@tanstack/react-query'
import { bankSyncKeys } from '@/api/cache/queryKeys'
import { invalidateTargets, type InvalidationTarget } from '@/api/cache/invalidation/types'

// The review inbox with its backlogs, and any bulk approval preview listing its items
const reviewItemTargets: InvalidationTarget[] = [
  { queryKey: bankSyncKeys.reviewAll },
  { queryKey: bankSyncKeys.bulkPreviews },
]

// What waits outside the ledger: the review items, the pending strip and the holds
const reviewTargets: InvalidationTarget[] = [
  ...reviewItemTargets,
  { queryKey: bankSyncKeys.pendingAll },
  { queryKey: bankSyncKeys.holdsAll },
]

const linkListTarget: InvalidationTarget = { queryKey: bankSyncKeys.links(), exact: true }

const connectionsTarget: InvalidationTarget = { queryKey: bankSyncKeys.connections(), exact: true }

/**
 * What bank sync shows of the user's data besides each account's bank link: the review inbox with its
 * backlogs, any bulk approval preview, the pending rows, the link list and the connections. A review
 * decision, sync, link or connection made in another tab or on another device changes them
 */
export const bankSyncTargets: InvalidationTarget[] = [...reviewTargets, linkListTarget, connectionsTarget]

/**
 * Invalidates what shows how links and connections stand: each account's bank link status, the
 * connections with their request budgets, and the providers with the institutions in use
 */
export function invalidateBankSyncStatus(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: bankSyncKeys.accountAll },
    connectionsTarget,
    { queryKey: bankSyncKeys.providers(), exact: true },
  ])
}

/**
 * Invalidates what waits outside the ledger: the review inbox, any bulk approval preview and the
 * pending strip
 */
export function invalidateBankReview(queryClient: QueryClient) {
  invalidateTargets(queryClient, reviewTargets)
}

/**
 * Invalidates the review inbox and any bulk approval preview listing its items, leaving the pending
 * strip, which only a sync changes
 */
export function invalidateBankReviewItems(queryClient: QueryClient) {
  invalidateTargets(queryClient, reviewItemTargets)
}

/**
 * Invalidates the link list, whose waiting counts and pause move with every review decision
 */
export function invalidateBankLinks(queryClient: QueryClient) {
  invalidateTargets(queryClient, [linkListTarget])
}

/**
 * Invalidates one account's bank link, with its balances and any offer it makes, and the link list
 * showing its status
 */
export function invalidateAccountBankLink(queryClient: QueryClient, accountId: string) {
  invalidateTargets(queryClient, [{ queryKey: bankSyncKeys.accountStatus(accountId), exact: true }, linkListTarget])
}
