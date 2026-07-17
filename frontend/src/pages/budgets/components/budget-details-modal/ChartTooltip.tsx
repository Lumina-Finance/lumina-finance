import { formatCurrency } from '@/utils/formatCurrency'
import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/TooltipContent'

export interface BudgetChartPoint {
  label: string
  spent: number
  limit: number
  utilizationPct: number

  // Marks a synthetic slot that renders a shaded archived band instead of a utilization bar
  archived?: boolean
  categories?: Array<{
    id: string
    name: string
    spent: number
    utilizationPct: number
    color: string
  }>
}

/**
 * Renders the shared chart tooltip content for budget utilization history
 */
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
      <ChartTooltipTitle className="font-medium">{point.label}</ChartTooltipTitle>
      <div className="mt-2 space-y-1">
        <ChartTooltipRow
          className="min-w-44"
          label="Used"
          value={formatCurrency(point.spent, currency)}
          financialValue
        />
        <ChartTooltipRow
          className="min-w-44"
          label="Limit"
          value={formatCurrency(point.limit, currency)}
          financialValue
        />
        <ChartTooltipRow
          className="min-w-44"
          label="Utilization"
          value={`${point.utilizationPct}%`}
          financialValue
        />
      </div>
      {categoryBreakdown.length > 1 && (
        <div className="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2">
          {categoryBreakdown.map((category) => (
            <ChartTooltipRow
              key={category.id}
              className="min-w-44 items-center"
              label={(
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: category.color }}
                    aria-hidden
                  />
                  <span className="truncate">{category.name}</span>
                </span>
              )}
              value={formatCurrency(category.spent, currency)}
              labelClassName="min-w-0"
              financialValue
            />
          ))}
        </div>
      )}
    </>
  )
}
