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
} from '../components/IncomeExpenseBreakdownCard'

function getBreakdownEntries(entries: InsightsBreakdownEntry[] | undefined): BreakdownEntry[] {
  return (entries ?? []).map(([id, name, amount]) => ({ id, name, amount }))
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
