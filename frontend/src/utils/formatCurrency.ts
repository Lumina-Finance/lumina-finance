import type { Currency } from '@/api/currency'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent } from '@/utils/moneyInput'
import { getNegativeAffixes, getShownAmountSign, signMovedAmount } from '@/utils/negativeAmount'

/**
 * Formats a currency's code, name, and symbol for selection and reference fields
 */
export function formatCurrencyLabel(currency: Currency): string {
  return `${currency.id}: ${currency.name} (${currency.symbol})`
}

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
 * This writes a magnitude. A negative is never left to Intl, whose accounting style gives brackets in
 * some languages and a hyphen in others, and is written by `formatMoneyParts` instead, so it reads
 * the same in every language
 */
export function createMoneyFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/**
 * Splits a held amount in major units into the parts of its text, with a negative written in the
 * held negative style around the whole of the magnitude, so the sign sits in the same place in every
 * language
 */
export function formatMoneyParts(value: number, currency: string, fractionDigits: number): Intl.NumberFormatPart[] {
  const formatter = createMoneyFormatter(currency, fractionDigits)
  if (value >= 0) return formatter.formatToParts(value)

  const { prefix, suffix } = getNegativeAffixes('held')
  return [
    { type: 'literal', value: prefix },
    ...formatter.formatToParts(-value),
    { type: 'literal', value: suffix },
  ]
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
export function resolveDisplayExponent(currency: string, currencies: Currency[]): number {
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
 * A negative is written before the amount is rounded, so without this a balance 40 cents over its
 * limit comes back as a negative zero such as ($0) on a meter that shows no decimals
 */
export function formatMajorUnits(value: number, currency: string, fractionDigits: number): string {
  const roundsToZero = Math.abs(value) < 0.5 / 10 ** fractionDigits
  return formatMoneyParts(roundsToZero ? 0 : value, currency, fractionDigits)
    .map((part) => part.value)
    .join('')
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
 * This is for held amounts (balances, net worth, credit used, limits). A negative is written in the
 * held negative style, which today is brackets, and an amount that rounds to zero never appears
 * wrapped that way. An amount that moved goes through `formatMovedCurrency`
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places
 */
export function formatCurrency(minorUnits: number, currency: string, currencies: Currency[]): string {
  const exponent = resolveDisplayExponent(currency, currencies)
  return formatMajorUnits(minorUnits / Math.pow(10, exponent), currency, exponent)
}

/**
 * Formats an amount that moved (a transaction, a net flow, a change, the adjustment an action will
 * record) in a currency's minor units, signed with a plus for money in and the moved negative style
 * for money out, which today is a true minus in every language. The sign follows the amount as
 * rounded to whole minor units, so an amount that shows as zero is left unsigned
 *
 * @param currencies - The fetched currency list, which carries each code's decimal places
 */
export function formatMovedCurrency(minorUnits: number, currency: string, currencies: Currency[]): string {
  const magnitude = Math.round(Math.abs(minorUnits))
  return signMovedAmount(getShownAmountSign(minorUnits), formatCurrency(magnitude, currency, currencies))
}
