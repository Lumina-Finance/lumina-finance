import type {
  CategoryBreakdownEntry,
  SpendingBreakdownResponse,
  SpendingRange,
} from '@/api/dashboard'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'

export type BreakdownMode = 'spending' | 'income'

export type SpendingBreakdownSummary = {
  entries: CategoryBreakdownEntry[]
  total: number
  chartKey: string
  categoryKind: CategoryBreakdownEntry['category_kind']
  colors: Map<string, string>
}

/**
 * Keeps synthetic Other slices aligned with the active breakdown mode colour family
 */
function getBreakdownCategoryColorId(
  entry: CategoryBreakdownEntry,
  fallbackKind: CategoryBreakdownEntry['category_kind'],
) {
  return entry.name === 'Other'
    ? `${entry.category_kind || fallbackKind}-other`
    : entry.category_id
}

/**
 * Falls back to summing entries when older responses do not provide explicit totals
 */
function getEntryTotal(entries: CategoryBreakdownEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * Derives the selected entry set, total, chart identity, and stable category colours
 */
export function getSpendingBreakdownSummary(
  spendingBreakdown: SpendingBreakdownResponse | undefined,
  breakdownMode: BreakdownMode,
  breakdownRange: SpendingRange,
): SpendingBreakdownSummary {
  const entries = spendingBreakdown
    ? breakdownMode === 'spending'
      ? spendingBreakdown.expense
      : spendingBreakdown.income
    : []
  const categoryKind = breakdownMode === 'spending' ? 'expense' : 'income'
  const fallbackTotal = getEntryTotal(entries)
  const total = spendingBreakdown
    ? breakdownMode === 'spending'
      ? spendingBreakdown.expense_total
      : spendingBreakdown.income_total
    : fallbackTotal
  const colors = getCategoryColorMap(entries.map((entry) => ({
    id: getBreakdownCategoryColorId(entry, categoryKind),
    name: entry.name,
    kind: entry.category_kind || categoryKind,
  })))

  return {
    entries,
    total,
    chartKey: `${breakdownMode}-${breakdownRange}`,
    categoryKind,
    colors,
  }
}

/**
 * Resolves the stable colour assigned to a breakdown entry with a deterministic fallback
 */
export function getSpendingBreakdownEntryColor(
  entry: CategoryBreakdownEntry,
  summary: SpendingBreakdownSummary,
) {
  const colorId = getBreakdownCategoryColorId(entry, summary.categoryKind)
  return summary.colors.get(colorId || entry.name) ?? getCategoryColor({
    id: colorId,
    name: entry.name,
    kind: entry.category_kind || summary.categoryKind,
  })
}
