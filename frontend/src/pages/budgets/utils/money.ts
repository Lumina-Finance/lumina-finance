import type { Currency } from '@/api/currency'
import { formatCurrencyLabel, formatCurrencySymbol } from '@/utils/formatCurrency'
import { findCurrencyExponent, toMinorUnits as toMinorUnitsCanonical } from '@/utils/moneyInput'

/**
 * Writes the symbol the reader's language uses for a loaded currency, or an empty string when the
 * currency isn't in the list
 */
export function currencySymbol(currencies: Currency[], code: string) {
  return currencies.some((currency) => currency.id === code) ? formatCurrencySymbol(code) : ''
}

/**
 * Builds the budget editor's currency dropdown options, labelled as every other currency dropdown is
 */
export function buildBudgetCurrencyOptions(currencies: Currency[]) {
  return currencies.map((currency) => ({ value: currency.id, label: formatCurrencyLabel(currency) }))
}

/**
 * Converts a canonical user-entered decimal amount into the currency's minor units, returning null
 * when the amount is blank, unparseable, or not strictly positive
 *
 * Also returns null when the currency is missing from the table, rather than scaling by an assumed two
 * decimal places. An amount converted through a guess is wrong for every currency that does not hold
 * two, and the caller already treats null as nothing to save
 */
export function toMinorUnits(value: string, currencies: Currency[], code: string): number | null {
  const exponent = findCurrencyExponent(currencies, code)
  if (exponent === null) return null

  const minorUnits = toMinorUnitsCanonical(value, exponent)
  if (minorUnits === null || minorUnits <= 0) return null

  return minorUnits
}
