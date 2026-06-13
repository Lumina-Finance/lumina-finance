import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/ChartTooltipContent'
import { formatCurrency } from '@/utils/formatCurrency'
import type { CashFlowBar } from '@/pages/accounts/detail/utils/cashFlowChartViewModel'

type CashFlowTooltipContentProps = {
  point: CashFlowBar
  currency: string
  title: string
}

/**
 * Renders inflow and outflow values for one monthly cash flow chart bar
 */
export function CashFlowTooltipContent({
  point,
  currency,
  title,
}: CashFlowTooltipContentProps) {
  return (
    <>
      <ChartTooltipTitle>{title}</ChartTooltipTitle>
      <ChartTooltipRow
        label="In"
        value={formatCurrency(point.income, currency)}
        financialValue
      />
      <ChartTooltipRow
        label="Out"
        value={formatCurrency(point.expense, currency)}
        financialValue
      />
    </>
  )
}
