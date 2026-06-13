import type { CategoryBreakdownEntry } from '@/api/dashboard'
import {
  ChartTooltipTitle,
  ChartTooltipValue,
} from '@/components/charts/TooltipContent'
import type { BreakdownMode } from '@/pages/dashboard/utils/getSpendingBreakdownSummary'
import { formatCurrency } from '@/utils/formatCurrency'
import { SpendingBreakdownCrossoverBadge } from './SpendingBreakdownCrossoverBadge'

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
        <ChartTooltipTitle>{entry.name}</ChartTooltipTitle>
        <SpendingBreakdownCrossoverBadge
          entry={entry}
          breakdownMode={breakdownMode}
        />
      </div>
      <ChartTooltipValue>
        {formatCurrency(entry.amount, displayCurrency)}
      </ChartTooltipValue>
    </>
  )
}
