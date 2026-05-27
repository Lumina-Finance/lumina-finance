
import { formatCurrency } from '@/utils/formatCurrency'

export interface BudgetChartPoint {
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
  point,
  currency,
}: {
  point: BudgetChartPoint
  currency: string
}) {
  const categoryBreakdown = point.categories ?? []

  return (
    <>
      <p className="app-chart-tooltip-default-title font-medium">{point.label}</p>
      <div className="mt-2 space-y-1">
        <div className="flex min-w-44 justify-between gap-4">
          <span className="app-chart-tooltip-default-value">Used</span>
          <span className="app-chart-tooltip-default-value font-financial">{formatCurrency(point.spent, currency)}</span>
        </div>
        <div className="flex min-w-44 justify-between gap-4">
          <span className="app-chart-tooltip-default-value">Limit</span>
          <span className="app-chart-tooltip-default-value font-financial">{formatCurrency(point.limit, currency)}</span>
        </div>
        <div className="flex min-w-44 justify-between gap-4">
          <span className="app-chart-tooltip-default-value">Utilization</span>
          <span className="app-chart-tooltip-default-value font-financial">{point.utilizationPct}%</span>
        </div>
      </div>
      {categoryBreakdown.length > 1 && (
        <div className="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2">
          {categoryBreakdown.map((category) => (
            <div key={category.id} className="flex min-w-44 items-center justify-between gap-4">
              <span className="app-chart-tooltip-default-value flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: category.color }}
                  aria-hidden
                />
                <span className="truncate">{category.name}</span>
              </span>
              <span className="app-chart-tooltip-default-value font-financial">{formatCurrency(category.spent, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
