import type { ReactNode } from 'react'
import type { SpendingRange } from '@/api/dashboard'
import {
  AVERAGE_LABEL_BY_RANGE,
  CURRENT_LABEL_BY_RANGE,
  PREVIOUS_LABEL_BY_RANGE,
} from '@/pages/dashboard/constants/ranges'
import type { SpendingComparisonBasis } from '@/pages/dashboard/types/dashboard'

type SpendingComparisonLegendProps = {
  spendingRange: SpendingRange
  basis: SpendingComparisonBasis
  currentHasData: boolean
  comparisonHasData: boolean

  /** A control at the legend's right end, its word on the labels' baseline and ending at the content edge */
  children?: ReactNode
}

/**
 * Renders current and comparison legend labels with empty-data wording
 */
export function SpendingComparisonLegend({
  spendingRange,
  basis,
  currentHasData,
  comparisonHasData,
  children,
}: SpendingComparisonLegendProps) {
  const items = [
    {
      key: 'current',
      color: 'var(--app-accent)',
      hasData: currentHasData,
      label: CURRENT_LABEL_BY_RANGE[spendingRange],
    },
    {
      key: basis,
      color: 'var(--app-text-muted)',
      hasData: comparisonHasData,
      label: (basis === 'average' ? AVERAGE_LABEL_BY_RANGE : PREVIOUS_LABEL_BY_RANGE)[spendingRange],
    },
  ]

  return (
    <div className="mb-2 mt-2 flex flex-wrap items-baseline gap-x-4">
      {items.map((item) => (
        <div key={item.key} className="flex items-baseline gap-1.5">
          <span
            className="inline-block h-2 w-2 self-center rounded-full"
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
      {/* The button's room around the word reaches past the content edge, into the card's padding the widget body's
          clip covers, and its room above and below overlaps the legend's own margins, so the row keeps its height */}
      {children && <div className="-my-2 -mr-[7px] ml-auto shrink-0 max-[1000px]:-my-[9px]">{children}</div>}
    </div>
  )
}
