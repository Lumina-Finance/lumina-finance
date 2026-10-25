import type { CreditUtilizationAccount, CreditUtilizationResponse } from '@/api/dashboard'
import { formatMissingFxPairs } from '@/utils/fxStatus'

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

export type CreditEmptyMessage = {
  message: string

  // Whether the user has something to put right, which the widget shows in the warning colour
  needsAttention: boolean
}

/**
 * Returns what the credit widget says when its limits add up to nothing
 *
 * A limit with no exchange rate adds nothing though the card has one, so a total missing a
 * conversion says a rate is missing rather than that no limit is set or that there are no accounts
 */
export function getCreditEmptyMessage(credit: CreditUtilizationResponse | undefined): CreditEmptyMessage {
  if (!credit?.accounts.some((account) => account.is_counted)) return { message: 'No credit accounts', needsAttention: false }
  if (credit.fx_status.state === 'incomplete' || credit.fx_status.state === 'unavailable') {
    return { message: `An exchange rate is missing for ${formatMissingFxPairs(credit.fx_status.missing_pairs)}`, needsAttention: true }
  }
  return { message: 'No credit limit set', needsAttention: false }
}
