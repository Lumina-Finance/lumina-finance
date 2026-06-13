import type { CategoryBreakdownEntry } from '@/api/dashboard'
import { BreakdownCrossoverBadge } from '@/components/display/BreakdownCrossoverBadge'
import type { BreakdownMode } from '@/pages/dashboard/utils/getSpendingBreakdownSummary'

type SpendingBreakdownCrossoverBadgeProps = {
  entry: CategoryBreakdownEntry
  breakdownMode: BreakdownMode
}

/**
 * Identifies category entries that cross the active spending or income breakdown mode
 */
function getSpendingBreakdownCrossoverKind(
  entry: CategoryBreakdownEntry,
  breakdownMode: BreakdownMode,
) {
  if (breakdownMode === 'spending' && entry.category_kind === 'income') return 'income-loss'
  if (breakdownMode === 'income' && entry.category_kind === 'expense') return 'expense-refund'
  return null
}

/**
 * Shows a crossover badge when refunds or losses appear in the opposite breakdown mode
 */
export function SpendingBreakdownCrossoverBadge({
  entry,
  breakdownMode,
}: SpendingBreakdownCrossoverBadgeProps) {
  const kind = getSpendingBreakdownCrossoverKind(entry, breakdownMode)
  return kind ? <BreakdownCrossoverBadge kind={kind} /> : null
}
