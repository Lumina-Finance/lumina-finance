import type { Currency } from '@/api/currency'
import { getCurrencyExponent } from '@/utils/moneyInput'

// Every amount the product renders goes through this locale, so a browser configured for another
// region still sees one currency convention. Under it CAD is "$" and USD is "US$", which keeps the
// two apart on a screen holding both. Kept separate from DATE_LOCALE in utils/date.ts, since the
// date convention and the currency convention could diverge later
export const MONEY_LOCALE = 'en-CA'

/**
 * Builds the pinned money formatter for a currency, fixed at the decimal places given
 *
 * Both fraction-digit options are set rather than left to Intl, whose own tables disagree with the
 * seeded currency list for 16 codes. Dividing by the seeded exponent without also fixing the places
 * rendered produces a wrong number: 123456 minor units of PKR divides to 1234.56, which Intl then
 * renders as "PKR 1,235" because it believes PKR has no decimals
 *
 * currencySign: 'accounting' renders negatives in parentheses, so -100 gives ($100.00)
 */
export function createMoneyFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/**
 * Converts an amount in a currency's minor units into its major units, using the decimal places
 * recorded for that currency
 *
 * -0 is normalized to 0, so an amount that divides to negative zero never reaches accounting style
 * and comes back wrapped in parentheses
 */
export function toMajorUnits(minorUnits: number, currency: string, currencies: Currency[]): number {
  return minorUnits / Math.pow(10, getCurrencyExponent(currencies, currency)) || 0
}

/**
 * Formats an integer amount in a currency's minor units as a currency string in the app's own
 * convention, rather than the reader's
 *
 * Negative amounts render in accounting style, wrapped in parentheses instead of a leading minus sign,
 * and -0 is normalized to 0 so a zero amount never appears wrapped in parentheses
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places. A code
 *   missing from it falls back to two places, so a list that has not arrived scales every amount by
 *   a guess
 */
export function formatCurrency(minorUnits: number, currency: string, currencies: Currency[]): string {
  const exponent = getCurrencyExponent(currencies, currency)
  return createMoneyFormatter(currency, exponent).format(toMajorUnits(minorUnits, currency, currencies))
}
