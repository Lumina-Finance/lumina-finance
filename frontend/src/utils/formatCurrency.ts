import type { Currency } from '@/api/currency'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent } from '@/utils/moneyInput'

/**
 * Builds the money formatter for a currency, fixed at the decimal places given
 *
 * The locale is left to the reader's own, which is what decides how a currency's symbol is written.
 * Where two currencies would otherwise share a symbol, a region writes its own plain and marks the
 * others: read from Canada, Canadian dollars are "$" and US dollars are "US$", and read from the
 * United States, US dollars are "$" and Canadian dollars are "CA$". A currency whose symbol collides
 * with nothing, such as the euro, is written plain everywhere. Each of those is right for the person
 * looking at it, so this follows the browser rather than naming a region. Note this is not what
 * utils/date.ts does, which pins one date convention, because a date has no home country to be read
 * as foreign from
 *
 * Both fraction-digit options are set rather than left to Intl, whose own tables disagree with the
 * seeded currency list for 16 codes. Dividing by the seeded exponent without also fixing the places
 * rendered produces a wrong number: 123456 minor units of PKR divides to 1234.56, which Intl then
 * renders as "PKR 1,235" because it believes PKR has no decimals
 *
 * currencySign: 'accounting' renders negatives in parentheses, so -100 gives ($100.00)
 */
export function createMoneyFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(undefined, {
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
 * 155 seeded codes. The fallback covers a code that list does not carry, such as one added to the
 * standard after the seed last ran, and it reads the browser rather than assuming a flat two, because
 * two is wrong by a factor of a hundred for a currency with no decimal places at all: a yen balance of
 * 500000 minor units would render as five thousand rather than five hundred thousand. A list that
 * fails to load never reaches here, since the app shows its recovery screen instead of rendering any
 * amount at all
 */
function resolveDisplayExponent(currency: string, currencies: Currency[]): number {
  const seeded = findCurrencyExponent(currencies, currency)
  if (seeded !== null) return seeded

  return new Intl.NumberFormat(undefined, { style: 'currency', currency })
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
 * Formats an integer amount in a currency's minor units as a currency string, written the way the
 * reader's own region writes it
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
