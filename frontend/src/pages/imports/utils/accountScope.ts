import type { AccountsOverview } from '@/api/accounts'

/**
 * What the import page does with the account its address points at
 *
 * `unscoped` is an ordinary import started from Settings, and `ready` is one started from an
 * account, which fixes every row to that account. The other three are what the page shows instead
 * of the flow
 */
export type ImportAccountScopeState = 'unscoped' | 'loading' | 'failed' | 'unavailable' | 'ready'

/** One mapping row's answer, and the facts that decide whether an import may be written to it */
export interface ImportableAccountFacts {
  is_archived?: boolean
  closed_at?: string | null
}

/**
 * Whether an import may write rows to this account
 *
 * The two states the app can see that stop an import: an archived account and a closed one. The API
 * refuses a third the accounts list says nothing about, which is an account shared with the user at
 * read level, so a true answer here means only that nothing on this side objects. Read both by the
 * control offering the import and by the page carrying it out, so the two cannot drift apart
 *
 * Asked of the two fields rather than of a whole account, since the transaction list is handed a
 * summary carrying only what it reads. A summary stating neither field is taken as an open account,
 * which is how the Add Transaction button beside it already reads a missing `is_archived`
 *
 * @param account - The account, or null where none has been loaded, which is not importable either
 */
export function isImportableAccount(account: ImportableAccountFacts | null | undefined): boolean {
  return Boolean(account) && !account?.is_archived && !account?.closed_at
}

/**
 * Says why an import cannot be written to this account, or nothing where it can
 *
 * Both states are read-only, and an account in both is described as archived, since that is the one
 * a user put it in and the one they can take it out of
 *
 * @param account - The account, or null where the control has no one account to import into, which
 *   has no reason to give
 */
export function getImportBlockReason(account: ImportableAccountFacts | null | undefined): string | undefined {
  if (!account || isImportableAccount(account)) return undefined
  return account.is_archived ? 'Archived accounts are read-only' : 'Closed accounts are read-only'
}

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

  if (isImportableAccount(account)) return 'ready'
  if (accountsCurrent) return 'unavailable'

  // Reached where the list in hand cannot answer the question and the request that would have has
  // failed, which nothing retries on its own, so the page offers the retry rather than waiting
  if (accountsError) return 'failed'

  return 'loading'
}
