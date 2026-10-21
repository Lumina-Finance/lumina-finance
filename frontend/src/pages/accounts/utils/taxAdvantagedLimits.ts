import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import type { TaxAdvantagedLimitSummary } from '@/pages/accounts/types/accounts'
import { type CompactMoneyRule, formatCompactMoney, formatRoundedMoney } from '@/utils/formatCompactMoney'
import { getRoundedPercent, type RoundingDirection } from '@/utils/rounding'
import { getValueMarkColor, type ValueMarkTone } from '@/utils/valueMarkColor'

/**
 * Places tax-advantaged usage in a band, or reports that there is no band to place it in
 *
 * Room used up exactly is not over the limit, so it reads as spent rather than as a problem
 */
function getTaxAdvantagedUsageTone(used: number, limit: number): ValueMarkTone | null {
  if (limit <= 0) return used > 0 ? 'negative' : null
  if (used / limit > 1) return 'negative'
  if (limit - used === 0) return null
  return 'accent'
}

/**
 * Chooses the colour of the percentage written beside a tax-advantaged meter
 */
export function getTaxAdvantagedUsageColor(used: number, limit: number): string {
  const tone = getTaxAdvantagedUsageTone(used, limit)
  if (tone === null) return 'var(--app-text-muted)'
  return tone === 'negative' ? 'var(--app-negative)' : 'var(--app-accent)'
}

/**
 * Chooses the colour of the meter bar itself, which is a shape rather than a figure
 */
export function getTaxAdvantagedUsageBarColor(used: number, limit: number): string {
  const tone = getTaxAdvantagedUsageTone(used, limit)
  if (tone === null) return 'var(--app-text-muted)'
  return getValueMarkColor(tone)
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

// The meters read at a glance beside a progress bar, so an amount small enough to render in full is
// whole, and a compacted one keeps one decimal like every compact amount
const METER_MONEY_RULES: CompactMoneyRule[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
  { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 1 },
]

/**
 * Formats compact meter amounts while preserving currency symbols. Room used and the amount over the
 * limit round up, and the limit and room left round down (`utils/rounding.ts`)
 *
 * No "≈" prefix, unlike the dashboard's compact amounts: the meter shows the figure beside the limit
 * it is measured against, where a marker of approximation on one and not the other would read as a
 * difference between them
 */
export function formatTaxAdvantagedMeterMoney(
  amount: number,
  currency: string,
  currencies: Currency[],
  rounding: RoundingDirection,
): string {
  return formatCompactMoney(amount, currency, METER_MONEY_RULES, currencies, rounding, {
    prefix: '',
    plainFractionDigits: 0,
  })
}

/**
 * Formats full tax-advantaged limit amounts for tooltip rows, whole dollars rounded the way the
 * meter rounds the same figure
 */
export function formatTaxAdvantagedRawMoney(
  amount: number,
  currency: string,
  currencies: Currency[],
  rounding: RoundingDirection,
): string {
  return formatRoundedMoney(amount, currency, currencies, 0, rounding)
}

/**
 * Returns the whole percent of the limit that is used for the usage label, rounded up and held
 * between 0 and 100 like the bar it sits beside
 */
export function getTaxAdvantagedUsageLabelPercent(used: number, limit: number): number {
  if (limit <= 0) return 100
  return clampTaxAdvantagedPercent(getRoundedPercent(used, limit, 'up'))
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
