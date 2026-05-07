
import { formatCurrency } from '@/utils/formatCurrency'

interface BudgetChartPoint {
  label: string
  spent: number
  limit: number
  utilizationPct: number
}

export default function BudgetChartTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean
  payload?: Array<{ payload?: BudgetChartPoint }>
  currency: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="app-tooltip-panel app-budget-chart-tooltip">
      <p className="font-medium">{point.label}</p>
      <div className="mt-2 space-y-1">
        <div className="flex min-w-44 justify-between gap-4">
          <span className="app-tooltip-muted">Used</span>
          <span>{formatCurrency(point.spent, currency)}</span>
        </div>
        <div className="flex min-w-44 justify-between gap-4">
          <span className="app-tooltip-muted">Limit</span>
          <span>{formatCurrency(point.limit, currency)}</span>
        </div>
        <div className="flex min-w-44 justify-between gap-4">
          <span className="app-tooltip-muted">Utilization</span>
          <span>{point.utilizationPct}%</span>
        </div>
      </div>
    </div>
  )
}
