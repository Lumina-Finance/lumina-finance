import type { AccountsOverview } from '@/api/accounts'

/**
 * What the import page does with the account its address points at
 *
 * `unscoped` is an ordinary import started from Settings, and `ready` is one started from an
 * account, which fixes every row to that account. The other three are what the page shows instead
 * of the flow
 */
export type ImportAccountScopeState = 'unscoped' | 'loading' | 'failed' | 'unavailable' | 'ready'

/**
 * Settles what the import page does with the account in its address
 *
 * An account is only importable while it is open and not archived, which is what the API asks of
 * every account an import writes rows to.
 *
 * Both stale readings of the accounts list wait for a current one: a list that predates the account
 * and a list that still calls it archived would each otherwise refuse an account that is fine on the
 * server, and that list is kept in local storage for months. An account the list holds as open is
 * taken at its word even while a refetch is in flight, so a background refresh never takes a staged
 * import off the screen
 *
 * @param accountId - The account the address points at, null on an ordinary import
 * @param account - That account as the loaded list holds it, undefined where the list has no such id
 * @param accountsCurrent - Whether the list is in hand, with no request in flight and none failed
 * @param accountsError - Whether the last request for the list failed, whatever is in hand
 */
export function getImportAccountScopeState({
  accountId,
  account,
  accountsCurrent,
  accountsError,
}: {
  accountId: string | null
  account: AccountsOverview | undefined
  accountsCurrent: boolean
  accountsError: boolean
}): ImportAccountScopeState {
  if (!accountId) return 'unscoped'

  if (account && !account.is_archived && !account.closed_at) return 'ready'
  if (accountsCurrent) return 'unavailable'

  // Reached where the list in hand cannot answer the question and the request that would have has
  // failed, which nothing retries on its own, so the page offers the retry rather than waiting
  if (accountsError) return 'failed'

  return 'loading'
}
