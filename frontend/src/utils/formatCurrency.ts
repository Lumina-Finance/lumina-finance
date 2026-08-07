// Every amount the product renders goes through this locale, so a browser configured for another
// region still sees one currency convention. Under it CAD is "$" and USD is "US$", which keeps the
// two apart on a screen holding both. Kept separate from DATE_LOCALE in utils/date.ts, since the
// date convention and the currency convention could diverge later
export const MONEY_LOCALE = 'en-CA'

// Format an integer amount in a currency's minor units (e.g. cents) as a currency string.
// Intl.NumberFormat knows the exponent for each ISO 4217 code, so we divide by 10^exponent before
// formatting. currencySign: 'accounting' renders negatives in parentheses, so -100 gives ($100.00)
/**
 * Formats an integer amount in a currency's minor units as a currency string in the app's own
 * convention, rather than the reader's
 *
 * Negative amounts render in accounting style, wrapped in parentheses instead of a leading minus sign,
 * and -0 is normalized to 0 so a zero amount never appears wrapped in parentheses
 */
export function formatCurrency(minorUnits: number, currency: string): string {
  const fmt = new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
  })
  const exponent = fmt.resolvedOptions().maximumFractionDigits ?? 2
  // Normalize -0 to 0 so accounting sign doesn't wrap zero in parentheses
  const value = minorUnits / Math.pow(10, exponent) || 0
  return fmt.format(value)
}
