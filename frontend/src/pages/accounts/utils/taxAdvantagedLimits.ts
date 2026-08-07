import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import type { TaxAdvantagedLimitSummary } from '@/pages/accounts/types/accounts'
import { type CompactMoneyRule, formatCompactMoney } from '@/utils/formatCompactMoney'
import { formatMajorUnits, toMajorUnits } from '@/utils/formatCurrency'

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

// The meters read at a glance beside a progress bar, so every amount on them is whole, both the
// compacted ones and the ones small enough to render in full
const METER_MONEY_RULES: CompactMoneyRule[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
  { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
]

/**
 * Formats compact meter amounts without decimals while preserving currency symbols
 *
 * No "≈" prefix, unlike the dashboard's compact amounts: the meter shows the figure beside the limit
 * it is measured against, where a marker of approximation on one and not the other would read as a
 * difference between them
 */
export function formatTaxAdvantagedMeterMoney(
  amount: number,
  currency: string,
  currencies: Currency[],
): string {
  return formatCompactMoney(amount, currency, METER_MONEY_RULES, currencies, {
    prefix: '',
    plainFractionDigits: 0,
  })
}

/**
 * Formats full tax-advantaged limit amounts for tooltip rows
 */
export function formatTaxAdvantagedRawMoney(
  amount: number,
  currency: string,
  currencies: Currency[],
): string {
  return formatMajorUnits(toMajorUnits(amount, currency, currencies), currency, 0)
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

/**
 * Builds tax-advantaged limit rows from active account links without applying page filters
 */
export function getTaxAdvantagedLimitSummaries(
  rows: AccountsOverview[],
  taxAdvantagedCategories: TaxAdvantagedCategory[],
): TaxAdvantagedLimitSummary[] {
  const linkedAccountCountByPlanId = new Map<string, number>()
  const activePlanIds = new Set<string>()
  const taxAdvantagedCategoryById = new Map(taxAdvantagedCategories.map((plan) => [plan.id, plan]))

  for (const account of rows) {
    if (account.group_id !== null || !account.tax_advantaged_category_id) continue
    if (!taxAdvantagedCategoryById.has(account.tax_advantaged_category_id)) continue
    activePlanIds.add(account.tax_advantaged_category_id)
    linkedAccountCountByPlanId.set(
      account.tax_advantaged_category_id,
      (linkedAccountCountByPlanId.get(account.tax_advantaged_category_id) ?? 0) + 1,
    )
  }

  return taxAdvantagedCategories
    .filter((plan) => activePlanIds.has(plan.id))
    .filter(hasTaxAdvantagedConfiguredLimit)
    .map((plan) => ({
      plan,
      linkedAccountCount: linkedAccountCountByPlanId.get(plan.id) ?? 0,
    }))
}

/**
 * Checks whether a tax-advantaged category has configured limits worth summarizing
 */
function hasTaxAdvantagedConfiguredLimit(plan: TaxAdvantagedCategory): boolean {
  return (
    plan.current_year_contribution_limit !== null ||
    plan.current_year_withdrawal_limit !== null ||
    plan.lifetime_contribution_limit !== null ||
    plan.accrued_lifetime_contribution_limit !== null
  )
}
