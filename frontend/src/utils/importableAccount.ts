/** The facts about an account that decide whether an import may be written to it */
export type ImportableAccountFacts = {
  can_write: boolean
  is_archived?: boolean

  // Why the account's currency keeps it read-only, when it does
  read_only_reason?: string | null
}

/**
 * Whether an import may write rows to this account
 *
 * The API writes rows only to an account the user can write to and has not archived, so an account
 * shared with the user at read level is refused like an archived one. Read both by the control
 * offering the import and by the page carrying it out, so the two cannot drift apart
 *
 * Asked of these fields rather than a whole account, since the transaction list is handed a
 * summary carrying only what it reads. A summary missing `is_archived` is taken as not archived,
 * which is how the Add transaction button beside it already reads that field
 *
 * @param account - The account, or null where none has been loaded, which is not importable either
 */
export function isImportableAccount(account: ImportableAccountFacts | null | undefined): boolean {
  return account?.can_write === true && !account.is_archived && !account.read_only_reason
}

/**
 * Says why an import cannot be written to this account, or nothing where it can
 *
 * Archived accounts are read-only until they are restored, and an account shared at read level
 * stays read-only whatever its state, as does one whose currency keeps it read-only. Archiving is
 * named first, as the transaction rows name it
 *
 * @param account - The account, or null where the control has no one account to import into, which
 *   has no reason to give
 */
export function getImportBlockReason(account: ImportableAccountFacts | null | undefined): string | undefined {
  if (!account || isImportableAccount(account)) return undefined
  if (account.is_archived) return 'Archived accounts are read-only'
  if (account.can_write !== true) return 'Read-only access'
  return account.read_only_reason ?? undefined
}
