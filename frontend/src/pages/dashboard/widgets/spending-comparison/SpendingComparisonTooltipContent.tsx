import type { SpendingRange } from '@/api/dashboard'
import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/ChartTooltipContent'
import {
  CURRENT_LABEL_BY_RANGE,
  PREVIOUS_LABEL_BY_RANGE,
} from '@/pages/dashboard/constants/ranges'
import type { SpendingComparisonSeriesPoint } from '@/pages/dashboard/types/dashboard'
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
      <ChartTooltipTitle>{point.label}</ChartTooltipTitle>
      {rows.map((row) => (
        <ChartTooltipRow
          key={row.key}
          label={row.label}
          value={formatCurrency(Number(row.value), displayCurrency)}
          financialValue
        />
      ))}
    </>
  )
}
