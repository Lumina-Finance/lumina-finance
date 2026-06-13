import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'

/**
 * Chooses the usage colour for tax-advantaged contribution and withdrawal meters
 */
export function getTaxAdvantagedUsageColor(used: number, limit: number): string {
  if (limit <= 0) return used > 0 ? 'var(--app-negative)' : 'var(--app-text-muted)'
  const ratio = used / limit
  if (ratio > 1) return 'var(--app-negative)'
  if (limit - used === 0) return 'var(--app-text-muted)'
  return 'var(--app-accent)'
}

/**
 * Converts tax-advantaged usage into a bounded meter percentage
 */
export function getTaxAdvantagedUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return 100
  return Math.min(Math.max((used / limit) * 100, 0), 100)
}

/**
 * Keeps CSS percentage widths inside valid progress-meter bounds
 */
export function clampTaxAdvantagedPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100)
}

/**
 * Chooses the display colour for remaining tax-advantaged room
 */
export function getTaxAdvantagedRemainingColor(remaining: number): string {
  if (remaining < 0) return 'var(--app-negative)'
  if (remaining === 0) return 'var(--app-text-muted)'
  return 'var(--app-accent)'
}

function getMajorCurrencyAmount(minorUnits: number, currency: string): number {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return minorUnits / Math.pow(10, exponent) || 0
}

function formatNoDecimalCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Adds a compact suffix after the final numeric part of a currency amount
 */
function formatNoDecimalCurrencyWithSuffix(
  value: number,
  currency: string,
  suffix: 'K' | 'M',
): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const parts = formatter.formatToParts(value)
  const numberPartTypes = new Set(['integer', 'group'])
  const suffixIndex = parts.findLastIndex((part) => numberPartTypes.has(part.type))

  return parts
    .map((part, index) => `${part.value}${index === suffixIndex ? suffix : ''}`)
    .join('')
}

/**
 * Formats compact meter amounts without decimals while preserving currency symbols
 */
export function formatTaxAdvantagedMeterMoney(amount: number, currency: string): string {
  const majorUnits = getMajorCurrencyAmount(amount, currency)
  const absoluteMajorUnits = Math.abs(majorUnits)
  if (absoluteMajorUnits >= 1_000_000) {
    return formatNoDecimalCurrencyWithSuffix(majorUnits / 1_000_000, currency, 'M')
  }
  if (absoluteMajorUnits >= 1_000) {
    return formatNoDecimalCurrencyWithSuffix(majorUnits / 1_000, currency, 'K')
  }
  return formatNoDecimalCurrency(majorUnits, currency)
}

/**
 * Formats full tax-advantaged limit amounts for tooltip rows
 */
export function formatTaxAdvantagedRawMoney(amount: number, currency: string): string {
  return formatNoDecimalCurrency(getMajorCurrencyAmount(amount, currency), currency)
}

/**
 * Finds the available lifetime room boundary before the absolute lifetime cap
 */
export function getLifetimeAvailableBoundary(plan: TaxAdvantagedCategory): number | null {
  if (
    plan.lifetime_contribution_limit === null ||
    plan.accrued_lifetime_contribution_limit === null
  ) {
    return null
  }

  const boundary = Math.min(
    plan.accrued_lifetime_contribution_limit,
    plan.lifetime_contribution_limit,
  )
  if (
    boundary <= plan.lifetime_contributions ||
    boundary >= plan.lifetime_contribution_limit
  ) {
    return null
  }

  return Math.max(boundary, 0)
}

/**
 * Checks whether a tax-advantaged category has any limit or activity worth showing
 */
export function hasTaxAdvantagedLimitTracking(plan: TaxAdvantagedCategory): boolean {
  return (
    plan.current_year_contribution_limit !== null ||
    plan.current_year_withdrawal_limit !== null ||
    plan.lifetime_contribution_limit !== null ||
    plan.accrued_lifetime_contribution_limit !== null ||
    plan.ytd_contributions !== 0 ||
    plan.ytd_withdrawals !== 0 ||
    plan.lifetime_contributions !== 0 ||
    plan.lifetime_withdrawals !== 0
  )
}
