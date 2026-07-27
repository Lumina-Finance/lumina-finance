import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'

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
 * Builds currency dropdown options, prepending the selected currency when it is not yet in the loaded list
 */
export function buildCurrencyOptions(currencies: Currency[], selectedCurrency: string) {
  const options = currencies.map((c) => ({ value: c.id, label: c.id }))
  if (selectedCurrency && !options.some((option) => option.value === selectedCurrency)) {
    return [{ value: selectedCurrency, label: selectedCurrency }, ...options]
  }
  return options
}
