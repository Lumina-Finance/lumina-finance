import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/TooltipContent'
import { formatCurrency } from '@/utils/formatCurrency'
import type { BalanceChartMode } from '@/pages/accounts/detail/constants/accountDetail'
import { formatSignedBalanceCurrency } from '@/pages/accounts/detail/utils/balanceChartAxis'
import type { BalanceChartDataPoint } from '@/pages/accounts/detail/utils/balanceChartViewModel'

type BalanceChartTooltipContentProps = {
  point: BalanceChartDataPoint
  chartMode: BalanceChartMode
  currency: string
}

/**
 * Renders the active balance chart point inside the shared chart tooltip
 */
export function BalanceChartTooltipContent({
  point,
  chartMode,
  currency,
}: BalanceChartTooltipContentProps) {
  const label = chartMode === 'balance' ? 'Balance' : 'Change'
  const value = chartMode === 'balance'
    ? formatCurrency(point.balance, currency)
    : formatSignedBalanceCurrency(point.periodBalance ?? 0, currency)

  return (
    <>
      <ChartTooltipTitle>{point.tooltipLabel}</ChartTooltipTitle>
      <ChartTooltipRow
        label={label}
        value={value}
        financialValue
      />
    </>
  )
}
