/**
 * Says why Add transaction cannot be used on the list of every account, or nothing where it can
 *
 * The create form offers only unarchived accounts, so with none of those it would open on a bare
 * "No results". Asked of the loaded accounts, never of a list still loading, which has no reason yet
 *
 * @param accounts - Every account the user can see, or undefined while they are loading
 */
export function getCreateBlockReason(
  accounts: ReadonlyArray<{ is_archived?: boolean }> | undefined,
): string | undefined {
  if (!accounts || accounts.some((account) => !account.is_archived)) return undefined
  return accounts.length === 0
    ? 'Create an account first'
    : 'All your accounts are archived: unarchive one or create an account first'
}
