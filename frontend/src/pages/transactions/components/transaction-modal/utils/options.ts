import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/pages/transactions/components/transaction-modal/constants'

/**
 * Builds account dropdown options, restricted to the transaction's own currency once editing
 *
 * An existing transaction keeps its currency, so only accounts holding that same currency can
 * carry it, while creating a transaction still offers every account and adopts its currency
 */
export function buildAccountOptions(
  selectableAccounts: AccountsOverview[],
  editing: boolean,
  currency: string,
) {
  const eligibleAccounts = editing && currency
    ? selectableAccounts.filter((account) => account.currency === currency)
    : selectableAccounts
  return eligibleAccounts.map((account) => ({ value: account.id, label: account.name }))
}

/**
 * Builds dropdown options for the other-account-recording field: the accounts the user holds, plus
 * a fixed entry for money that left the tracked accounts entirely
 *
 * Unfiltered by currency, unlike the main account field, since recording an account is a fact about
 * where the money went rather than a second leg that must share a currency. Archived accounts are
 * left out, matching the main account field: an archived account takes no new transactions and its
 * existing ones are read-only, so offering it here would be the one place it still accepted work
 */
export function buildOtherAccountOptions(
  accounts: AccountsOverview[],
  recordedAccountId: string,
  isSymmetricTransfer: boolean,
) {
  // Money cannot move from an account to itself, so the account holding the transfer is left out
  // rather than offered and then refused
  const eligibleAccounts = accounts
    .filter((account) => account.id !== recordedAccountId && !account.is_archived)
    .map((account) => ({ value: account.id, label: account.name }))

  // Ticking the checkbox makes this the account the matching transaction is written to, and there
  // is nowhere outside the app to write one, so the entry is not offered there
  if (isSymmetricTransfer) return eligibleAccounts

  // First, because it is the one answer that is not a search through the account list
  return [{ value: OUTSIDE_ACCOUNT_VALUE, label: OUTSIDE_ACCOUNT_LABEL }, ...eligibleAccounts]
}

/**
 * Builds currency dropdown options, prepending the selected currency when it is not yet in the loaded list
 */
export function buildCurrencyOptions(currencies: Currency[], selectedCurrency: string) {
  const options = currencies.map((c) => ({ value: c.id, label: c.id }))
  if (selectedCurrency && !options.some((option) => option.value === selectedCurrency)) {
    return [{ value: selectedCurrency, label: selectedCurrency }, ...options]
  }
  return options
}
