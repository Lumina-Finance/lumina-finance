import type { Currency } from '@/api/currency'
import { getCurrencyExponent, toMinorUnits as toMinorUnitsCanonical } from '@/utils/moneyInput'

/**
 * Looks up the currency's symbol by code, returning an empty string when the currency isn't found
 */
export function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.symbol ?? ''
}

/**
 * Converts a canonical user-entered decimal amount into the currency's minor units, returning null
 * when the amount is blank, unparseable, or not strictly positive
 */
export function toMinorUnits(value: string, currencies: Currency[], code: string): number | null {
  const minorUnits = toMinorUnitsCanonical(value, getCurrencyExponent(currencies, code))
  if (minorUnits === null || minorUnits <= 0) return null

  return minorUnits
}
