import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/TooltipContent'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type { CashFlowBar } from '@/pages/accounts/detail/utils/cashFlowChartViewModel'

type MonthlyCashFlowTooltipContentProps = {
  point: CashFlowBar
  currency: string
  title: string
}

/**
 * Renders inflow and outflow values for one monthly cash flow chart bar
 */
export function MonthlyCashFlowTooltipContent({
  point,
  currency,
  title,
}: MonthlyCashFlowTooltipContentProps) {
  const { formatCurrency } = useMoneyFormatters()

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
