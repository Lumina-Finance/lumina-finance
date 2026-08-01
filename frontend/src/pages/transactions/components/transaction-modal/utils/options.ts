import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import { OUTSIDE_ACCOUNT_VALUE } from '@/pages/transactions/components/transaction-modal/constants'

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
 * Builds dropdown options for the other-account-recording field: every account the user holds,
 * plus a fixed entry for money that left the tracked accounts entirely
 *
 * Unfiltered by currency or archived status, unlike the main account field: recording an account
 * is a fact about where the money went rather than a second leg that must share a currency, and an
 * archived or closed account still stays recordable since archiving happens after the money moved
 */
export function buildOtherAccountOptions(accounts: AccountsOverview[], recordedAccountId: string) {
  return [
    // Money cannot move from an account to itself, so the account holding the transfer is left out
    // rather than offered and then refused
    ...accounts
      .filter((account) => account.id !== recordedAccountId)
      .map((account) => ({ value: account.id, label: account.name })),
    { value: OUTSIDE_ACCOUNT_VALUE, label: 'Outside this app' },
  ]
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
