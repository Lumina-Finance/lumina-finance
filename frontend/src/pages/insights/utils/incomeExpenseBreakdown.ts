import type {
  InsightsBreakdownEntry,
  InsightsCategoryTrendEntry,
  InsightsIncomeExpenseBreakdownResponse,
} from '@/api/insights'
import type {
  BreakdownEntry,
  BreakdownMode,
  CategoryDriver,
  CategoryTrendSection,
} from '@/pages/insights/types/incomeExpenseBreakdown'

function getBreakdownEntries(entries: InsightsBreakdownEntry[] | undefined): BreakdownEntry[] {
  return (entries ?? []).map(([id, name, categoryKind, amount]) => ({
    id,
    name,
    categoryKind,
    amount,
  }))
}

function getCategoryDrivers(entries: InsightsCategoryTrendEntry[] | undefined): CategoryDriver[] {
  return (entries ?? []).map(([id, name, amount, previousAmount, changePct, transactionCount]) => ({
    id,
    name,
    amount,
    previousAmount,
    changePct,
    transactionCount,
  }))
}

/**
 * Picks the income or expense category entries for the active breakdown mode
 */
export function getBreakdownEntriesForMode(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: BreakdownMode,
): BreakdownEntry[] {
  return getBreakdownEntries(mode === 'expense' ? data?.expense : data?.income)
}

/**
 * Returns the income or expense total for the active breakdown mode, falling back to summing the
 * category entries when the server total is missing or not finite
 */
export function getBreakdownTotalForMode(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: BreakdownMode,
): number {
  if (!data) return 0
  const total = mode === 'expense' ? data.expense_total : data.income_total
  if (Number.isFinite(total)) return total

  return getBreakdownEntries(mode === 'expense' ? data.expense : data.income)
    .reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * Builds the increases and decreases sections for the category trend list, using the entries
 * that match the active breakdown mode
 */
export function getCategoryTrendSections(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: BreakdownMode,
): CategoryTrendSection[] {
  return [
    {
      id: 'increases',
      label: 'Top Increases',
      drivers: getCategoryDrivers(mode === 'expense' ? data?.expense_increases : data?.income_increases),
    },
    {
      id: 'decreases',
      label: 'Top Decreases',
      drivers: getCategoryDrivers(mode === 'expense' ? data?.expense_decreases : data?.income_decreases),
    },
  ]
}
