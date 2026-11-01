import type { SpendingRange } from '@/api/dashboard'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/TooltipContent'
import {
  AVERAGE_LABEL_BY_RANGE,
  CURRENT_LABEL_BY_RANGE,
  PREVIOUS_LABEL_BY_RANGE,
} from '@/pages/dashboard/constants/ranges'
import type { SpendingComparisonBasis, SpendingComparisonSeriesPoint } from '@/pages/dashboard/types/dashboard'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

type SpendingComparisonTooltipContentProps = {
  point: SpendingComparisonSeriesPoint
  displayCurrency: string
  spendingRange: SpendingRange
  basis: SpendingComparisonBasis
}

/**
 * Renders only populated current and comparison rows for a spending comparison chart point
 */
export function SpendingComparisonTooltipContent({
  point,
  displayCurrency,
  spendingRange,
  basis,
}: SpendingComparisonTooltipContentProps) {
  const { formatCurrency } = useMoneyFormatters()
  const rows = [
    {
      key: 'current',
      label: CURRENT_LABEL_BY_RANGE[spendingRange],
      value: point.current,
    },
    {
      key: basis,
      label: (basis === 'average' ? AVERAGE_LABEL_BY_RANGE : PREVIOUS_LABEL_BY_RANGE)[spendingRange],
      value: point[basis],
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
