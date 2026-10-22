import type {
  InsightsBreakdownCategoryKind,
  InsightsBreakdownEntry,
  InsightsCategoryTrendEntry,
  InsightsIncomeExpenseBreakdownResponse,
} from '@/api/insights'
import { getChangePercent } from '@/utils/rounding'
import type {
  BreakdownEntry,
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

// A rise in spending rounds up and a rise in income rounds down, so a change never reads better than it is
function getCategoryDrivers(
  entries: InsightsCategoryTrendEntry[] | undefined,
  mode: InsightsBreakdownCategoryKind,
): CategoryDriver[] {
  return (entries ?? []).map(([id, name, amount, previousAmount, transactionCount]) => ({
    id,
    name,
    amount,
    previousAmount,
    changePct: getChangePercent(amount, previousAmount, mode === 'expense' ? 'up' : 'down'),
    transactionCount,
  }))
}

/**
 * Picks the income or expense category entries for the active breakdown mode
 */
export function getBreakdownEntriesForMode(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: InsightsBreakdownCategoryKind,
): BreakdownEntry[] {
  return getBreakdownEntries(mode === 'expense' ? data?.expense : data?.income)
}

/**
 * Returns the income or expense total for the active breakdown mode, falling back to summing the
 * category entries when the server total is missing or not finite
 */
export function getBreakdownTotalForMode(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: InsightsBreakdownCategoryKind,
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
  mode: InsightsBreakdownCategoryKind,
): CategoryTrendSection[] {
  return [
    {
      id: 'increases',
      label: 'Top increases',
      drivers: getCategoryDrivers(mode === 'expense' ? data?.expense_increases : data?.income_increases, mode),
    },
    {
      id: 'decreases',
      label: 'Top decreases',
      drivers: getCategoryDrivers(mode === 'expense' ? data?.expense_decreases : data?.income_decreases, mode),
    },
  ]
}
