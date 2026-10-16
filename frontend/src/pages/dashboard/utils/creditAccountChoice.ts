import type { CreditUtilizationAccount } from '@/api/dashboard'

/**
 * Returns the IDs of the credit accounts the server currently leaves out
 *
 * The choice is kept as the accounts left out, never the ones counted, so a card added while the
 * chooser is open counts until the user leaves it out
 */
export function getExcludedAccountIds(accounts: CreditUtilizationAccount[]): Set<string> {
  return new Set(accounts.filter((account) => !account.is_counted).map((account) => account.id))
}

/**
 * Returns a copy of the left-out set with one account moved in or out of it
 */
export function toggleExcludedAccount(excludedIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(excludedIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Reports whether two left-out sets hold different accounts
 */
export function isExclusionChanged(saved: ReadonlySet<string>, draft: ReadonlySet<string>): boolean {
  if (saved.size !== draft.size) return true
  for (const id of draft) if (!saved.has(id)) return true
  return false
}

/**
 * Reports whether the user has credit accounts but counts none of them
 */
export function areAllAccountsLeftOut(accounts: CreditUtilizationAccount[]): boolean {
  return accounts.length > 0 && accounts.every((account) => !account.is_counted)
}
