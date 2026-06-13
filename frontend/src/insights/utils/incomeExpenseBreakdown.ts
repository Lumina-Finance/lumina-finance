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
} from '@/insights/types/incomeExpenseBreakdown'

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

export function getBreakdownEntriesForMode(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: BreakdownMode,
): BreakdownEntry[] {
  return getBreakdownEntries(mode === 'expense' ? data?.expense : data?.income)
}

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
