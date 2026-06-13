import type { CategoryBreakdownEntry } from '@/api/dashboard'
import { SpendingBreakdownCrossoverBadge } from '@/dashboard/components/SpendingBreakdownCrossoverBadge'
import {
  getSpendingBreakdownEntryColor,
  type BreakdownMode,
  type SpendingBreakdownSummary,
} from '@/dashboard/utils/getSpendingBreakdownSummary'

type SpendingBreakdownLegendProps = {
  entries: CategoryBreakdownEntry[]
  breakdownMode: BreakdownMode
  summary: SpendingBreakdownSummary
}

/**
 * Renders coloured labels for every visible breakdown slice
 */
export function SpendingBreakdownLegend({
  entries,
  breakdownMode,
  summary,
}: SpendingBreakdownLegendProps) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2">
      {entries.map((entry) => (
        <div key={entry.category_id} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: getSpendingBreakdownEntryColor(entry, summary) }}
          />
          <span
            className="whitespace-nowrap text-xs font-medium max-[1000px]:text-[0.675rem]"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {entry.name}
          </span>
          <SpendingBreakdownCrossoverBadge
            entry={entry}
            breakdownMode={breakdownMode}
          />
        </div>
      ))}
    </div>
  )
}
