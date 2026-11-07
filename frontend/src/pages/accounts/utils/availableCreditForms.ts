import type { Currency } from '@/api/currency'
import { resolveDisplayExponent } from '@/utils/formatCurrency'
import { divideRounded } from '@/utils/rounding'

// The amount's digits with their grouping and decimal marks, leaving any currency text or brackets around
// them. The space class takes the narrow and no-break spaces some regions group with
const FIGURE_PATTERN = /\d(?:[\d.,'\s]*\d)?/

/**
 * Formats the size of a figure with the reader's own grouping at a fixed number of decimal places
 */
function formatSize(value: number, fractionDigits: number, suffix = '') {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.abs(value))}${suffix}`
}

/**
 * Lists the ways a card's available credit can be written beside its type on a phone, from longest
 * to shortest: in full, then whole, then in thousands to one decimal place, then in whole thousands.
 * A row shows the longest that fits, and none when even the last doesn't
 *
 * Each shorter form swaps only the figure in the full form, so it keeps the currency and the brackets
 * of an amount over the limit, and reads like the balance beside it. Each rounds down, as an amount
 * still available never reads as more than it is. An amount under a thousand has no thousands forms
 *
 * @param full - The amount as written in full, with its currency
 */
export function getAvailableCreditForms(minorUnits: number, currency: string, currencies: Currency[], full: string) {
  const unit = 10 ** resolveDisplayExponent(currency, currencies)
  const withFigure = (figure: string) => full.replace(FIGURE_PATTERN, figure)
  const forms = [full, withFigure(formatSize(divideRounded(minorUnits, unit, 'down'), 0))]
  if (Math.abs(minorUnits) >= 1000 * unit) {
    forms.push(withFigure(formatSize(divideRounded(minorUnits, 100 * unit, 'down') / 10, 1, 'K')))
    forms.push(withFigure(formatSize(divideRounded(minorUnits, 1000 * unit, 'down'), 0, 'K')))
  }
  // A currency with no minor unit writes its whole form as its full one
  return [...new Set(forms)].map((form) => `${form} avail.`)
}
