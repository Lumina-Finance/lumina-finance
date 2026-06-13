import type { CategoryBreakdownEntry } from '@/api/dashboard'
import { SpendingBreakdownCrossoverBadge } from '@/dashboard/components/SpendingBreakdownCrossoverBadge'
import type { BreakdownMode } from '@/dashboard/utils/getSpendingBreakdownSummary'
import { formatCurrency } from '@/utils/formatCurrency'

type SpendingBreakdownTooltipContentProps = {
  entry: CategoryBreakdownEntry
  breakdownMode: BreakdownMode
  displayCurrency: string
}

/**
 * Renders the active breakdown slice details inside the cursor tooltip
 */
export function SpendingBreakdownTooltipContent({
  entry,
  breakdownMode,
  displayCurrency,
}: SpendingBreakdownTooltipContentProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="app-chart-tooltip-default-title">
          {entry.name}
        </span>
        <SpendingBreakdownCrossoverBadge
          entry={entry}
          breakdownMode={breakdownMode}
        />
      </div>
      <div className="app-chart-tooltip-default-value">
        {formatCurrency(entry.amount, displayCurrency)}
      </div>
    </>
  )
}
