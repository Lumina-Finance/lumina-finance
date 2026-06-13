import type { SpendingRange } from '@/api/dashboard'
import {
  CURRENT_LABEL_BY_RANGE,
  PREVIOUS_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'
import type { SpendingComparisonSeriesPoint } from '@/dashboard/types/dashboard'
import { formatCurrency } from '@/utils/formatCurrency'

type SpendingComparisonTooltipContentProps = {
  point: SpendingComparisonSeriesPoint
  displayCurrency: string
  spendingRange: SpendingRange
}

/**
 * Renders only populated current and previous rows for a spending comparison chart point
 */
export function SpendingComparisonTooltipContent({
  point,
  displayCurrency,
  spendingRange,
}: SpendingComparisonTooltipContentProps) {
  const rows = [
    {
      key: 'current',
      label: CURRENT_LABEL_BY_RANGE[spendingRange],
      value: point.current,
    },
    {
      key: 'previous',
      label: PREVIOUS_LABEL_BY_RANGE[spendingRange],
      value: point.previous,
    },
  ].filter((row) => row.value != null)

  return (
    <>
      <p className="app-chart-tooltip-default-title">{point.label}</p>
      {rows.map((row) => (
        <div key={row.key} className="mt-1 flex justify-between gap-4">
          <span className="app-chart-tooltip-default-value">{row.label}</span>
          <span className="app-chart-tooltip-default-value font-financial">
            {formatCurrency(Number(row.value), displayCurrency)}
          </span>
        </div>
      ))}
    </>
  )
}
