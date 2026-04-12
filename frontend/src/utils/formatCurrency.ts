// Format an integer amount in a currency's minor units (e.g. cents) as a
// localized currency string. Intl.NumberFormat knows the exponent for each
// ISO 4217 code, so we divide by 10^exponent before formatting.
// currencySign: 'accounting' renders negatives in parentheses — e.g. -100 → ($100.00).
export function formatCurrency(minorUnits: number, currency: string): string {
  const fmt = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
  })
  const exponent = fmt.resolvedOptions().maximumFractionDigits ?? 2
  return fmt.format(minorUnits / Math.pow(10, exponent))
}
