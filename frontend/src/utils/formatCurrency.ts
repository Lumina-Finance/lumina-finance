// Format an integer amount in a currency's minor units (e.g. cents) as a
// localized currency string. Intl.NumberFormat knows the exponent for each
// ISO 4217 code, so we divide by 10^exponent before formatting
// currencySign: 'accounting' renders negatives in parentheses — e.g. -100 → ($100.00)
/**
 * Formats an integer amount in a currency's minor units as a localized currency string
 *
 * Negative amounts render in accounting style, wrapped in parentheses instead of a leading minus sign,
 * and -0 is normalized to 0 so a zero amount never appears wrapped in parentheses
 */
export function formatCurrency(minorUnits: number, currency: string): string {
  const fmt = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
  })
  const exponent = fmt.resolvedOptions().maximumFractionDigits ?? 2
  // Normalize -0 to 0 so accounting sign doesn't wrap zero in parentheses
  const value = minorUnits / Math.pow(10, exponent) || 0
  return fmt.format(value)
}
