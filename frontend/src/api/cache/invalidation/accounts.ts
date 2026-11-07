import type { QueryClient } from '@tanstack/react-query'
import { accountKeys, bankSyncKeys } from '@/api/cache/queryKeys'
import { invalidateTargets } from '@/api/cache/invalidation/types'

/**
 * Invalidates the account list used by account summaries and selectors
 */
function invalidateAccountSummaries(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.list(), exact: true }])
}

/**
 * Invalidates all account-scoped queries
 */
export function invalidateAccounts(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.all }])
}

/**
 * Invalidates every account's queries and bank link after a balance change on accounts that aren't
 * known, since each bank link compares the bank's balance with the ledger's
 */
export function invalidateAllAccountBalances(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: accountKeys.all }, { queryKey: bankSyncKeys.accountAll }])
}

/**
 * Invalidates account balances and balance history after balance-changing mutations, and the
 * accounts' bank links. Those compare the bank's balance with the ledger's
 */
export function invalidateAccountBalances(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSummaries(queryClient)
  invalidateTargets(
    queryClient,
    accountIds.flatMap((accountId) => [
      { queryKey: accountKeys.detail(accountId), exact: true },
      { queryKey: accountKeys.snapshotsAll(accountId) },
      { queryKey: bankSyncKeys.accountStatus(accountId), exact: true },
    ]),
  )
}

/**
 * Invalidates merchant and category spending without refreshing account cash flow
 */
export function invalidateAccountSpending(queryClient: QueryClient, accountIds: string[]) {
  invalidateTargets(
    queryClient,
    accountIds.map((accountId) => ({
      queryKey: accountKeys.spendingBreakdownAll(accountId),
    })),
  )
}

/**
 * Invalidates account activity widgets after transaction changes
 */
export function invalidateAccountActivity(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSpending(queryClient, accountIds)
  invalidateTargets(
    queryClient,
    accountIds.map((accountId) => ({
      queryKey: accountKeys.cashFlowAll(accountId),
    })),
  )
}

/**
 * Invalidates every cached query under specific account scopes, and the accounts' bank links. Those
 * compare the bank's balance with the ledger's
 */
export function invalidateAccountData(queryClient: QueryClient, accountIds: string[]) {
  invalidateAccountSummaries(queryClient)
  invalidateTargets(
    queryClient,
    accountIds.flatMap((accountId) => [
      { queryKey: accountKeys.accountScope(accountId) },
      { queryKey: bankSyncKeys.accountStatus(accountId), exact: true },
    ]),
  )
}
