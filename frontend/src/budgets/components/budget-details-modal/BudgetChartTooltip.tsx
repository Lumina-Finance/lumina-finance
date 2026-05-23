
import { formatCurrency } from '@/utils/formatCurrency'

interface BudgetChartPoint {
  label: string
  spent: number
  limit: number
  utilizationPct: number
  categories?: Array<{
    id: string
    name: string
    spent: number
    utilizationPct: number
    color: string
  }>
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
  const categoryBreakdown = point.categories?.filter((category) => category.spent > 0) ?? []

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
      {categoryBreakdown.length > 1 && (
        <div className="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2">
          {categoryBreakdown.map((category) => (
            <div key={category.id} className="flex min-w-44 items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-2 app-tooltip-muted">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: category.color }}
                  aria-hidden
                />
                <span className="truncate">{category.name}</span>
              </span>
              <span>{formatCurrency(category.spent, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
