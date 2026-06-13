import type { SpendingRange } from '@/api/dashboard'
import {
  CURRENT_LABEL_BY_RANGE,
  PREVIOUS_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'

type SpendingComparisonLegendProps = {
  spendingRange: SpendingRange
  currentHasData: boolean
  previousHasData: boolean
}

/**
 * Renders current and previous period legend labels with empty-data wording
 */
export function SpendingComparisonLegend({
  spendingRange,
  currentHasData,
  previousHasData,
}: SpendingComparisonLegendProps) {
  const items = [
    {
      key: 'current',
      color: 'var(--app-accent)',
      hasData: currentHasData,
      label: CURRENT_LABEL_BY_RANGE[spendingRange],
    },
    {
      key: 'previous',
      color: 'var(--app-text-muted)',
      hasData: previousHasData,
      label: PREVIOUS_LABEL_BY_RANGE[spendingRange],
    },
  ]

  return (
    <div className="mb-2 mt-2 flex items-center gap-4">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: item.color,
              opacity: item.hasData ? 1 : 0.4,
            }}
          />
          <span
            className="text-xs max-[1000px]:text-[0.675rem]"
            style={{
              color: 'var(--app-text-muted)',
              fontStyle: item.hasData ? 'normal' : 'italic',
            }}
          >
            {item.hasData ? item.label : `No data for ${item.label.toLowerCase()}`}
          </span>
        </div>
      ))}
    </div>
  )
}
