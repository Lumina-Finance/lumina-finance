/** The facts about an account that decide whether its transactions can change */
type AccountWriteFacts = {
  is_archived?: boolean

  // Why the account's currency keeps it read-only, when it does
  read_only_reason?: string | null
}

const ARCHIVED_REASON = 'Archived accounts are read-only'

/**
 * Says why no transaction can be added to or changed on this account, or nothing where one can
 *
 * Archived accounts are read-only until they are restored, and an account whose currency keeps it
 * read-only stays so with the server's sentence. Archiving is named first, as the transaction rows
 * name it. Read by the account page's Add transaction, the transaction form, the bulk edit and the
 * Transactions page alike, so none of them offers a change another holds back
 *
 * @param account - The account, or nothing where none has been loaded. Nothing gives no reason
 */
export function getAccountWriteBlockReason(account: AccountWriteFacts | null | undefined): string | undefined {
  if (account?.is_archived) return ARCHIVED_REASON
  return account?.read_only_reason || undefined
}

/**
 * Names what holds a read-only transaction form's account, for the form's header: archived, or kept
 * read-only by the server. A form held read-only for no reason of the account's own reads as archived,
 * as the form always called it
 */
export function describeReadOnlyAccount(account: AccountWriteFacts | null | undefined): string {
  const reason = getAccountWriteBlockReason(account)
  return reason === undefined || reason === ARCHIVED_REASON ? 'Archived account' : 'Read-only account'
}

/**
 * Whether a transaction opens read-only from the Transactions page, since its account takes no change
 *
 * @param accountId - The transaction's account
 * @param accounts - Every account the page has loaded, or undefined while they load
 */
export function isOnReadOnlyAccount(
  accountId: string,
  accounts: ReadonlyArray<AccountWriteFacts & { id: string }> | undefined,
): boolean {
  return getAccountWriteBlockReason(accounts?.find((account) => account.id === accountId)) !== undefined
}

/**
 * Says why Add transaction cannot be used on the list of every account, or nothing where it can
 *
 * The create form offers only accounts that take a new transaction, so with none of those it would
 * open on a bare "No results". A list still loading gives no reason. With every unarchived account
 * kept read-only, the server's sentence for one of them says why
 *
 * @param accounts - Every account the user can see, or undefined while they are loading
 */
export function getCreateBlockReason(accounts: ReadonlyArray<AccountWriteFacts> | undefined): string | undefined {
  if (!accounts || accounts.some((account) => !getAccountWriteBlockReason(account))) return undefined
  if (accounts.length === 0) return 'Create an account first'
  const readOnly = accounts.find((account) => !account.is_archived)
  return readOnly
    ? getAccountWriteBlockReason(readOnly)
    : 'All your accounts are archived: unarchive one or create an account first'
}
