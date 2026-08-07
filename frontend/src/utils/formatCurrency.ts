import type { Currency } from '@/api/currency'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent } from '@/utils/moneyInput'

// Every amount rendered as money goes through this locale, so a browser configured for another
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
 * Returns the decimal places to render a currency at
 *
 * The seeded list is the authority, since the browser's own figures disagree with it for 16 of the
 * 155 seeded codes. A code the list does not carry falls back to the browser rather than to a flat
 * two, because two is wrong by a factor of a hundred for a currency with no decimal places at all:
 * a list that failed to load would otherwise render a ¥500,000 balance as JP¥5,000.00. The browser
 * is right for 139 of the 155 and is what the app rendered before the list was read at all, so an
 * unreachable currency service costs the decimals of 16 currencies rather than a hundredfold error
 */
function resolveDisplayExponent(currency: string, currencies: Currency[]): number {
  const seeded = findCurrencyExponent(currencies, currency)
  if (seeded !== null) return seeded

  return new Intl.NumberFormat(MONEY_LOCALE, { style: 'currency', currency })
    .resolvedOptions()
    .maximumFractionDigits ?? DEFAULT_MINOR_UNIT_EXPONENT
}

/**
 * Formats an amount already in major units at a fixed number of decimal places
 *
 * An amount too small to show at those places is rendered as zero rather than as a signed value.
 * Accounting style decides to wrap a negative in parentheses before rounding it, so without this a
 * balance 40 cents over its limit comes back as ($0) on a meter that shows no decimals
 */
export function formatMajorUnits(value: number, currency: string, fractionDigits: number): string {
  const roundsToZero = Math.abs(value) < 0.5 / 10 ** fractionDigits
  return createMoneyFormatter(currency, fractionDigits).format(roundsToZero ? 0 : value)
}

/**
 * Converts an amount in a currency's minor units into its major units, using the decimal places
 * recorded for that currency
 */
export function toMajorUnits(minorUnits: number, currency: string, currencies: Currency[]): number {
  return minorUnits / Math.pow(10, resolveDisplayExponent(currency, currencies))
}

/**
 * Formats an integer amount in a currency's minor units as a currency string in the app's own
 * convention, rather than the reader's
 *
 * Negative amounts render in accounting style, wrapped in parentheses instead of a leading minus sign,
 * and an amount that rounds to zero never appears wrapped that way
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places
 */
export function formatCurrency(minorUnits: number, currency: string, currencies: Currency[]): string {
  const exponent = resolveDisplayExponent(currency, currencies)
  return formatMajorUnits(minorUnits / Math.pow(10, exponent), currency, exponent)
}
