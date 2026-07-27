import type { BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'
import BudgetUtilizationBar from '@/pages/budgets/components/budget-details-modal/UtilizationBar'
import type { BudgetChartCategory } from '@/pages/budgets/utils/budgetDetails'

type StackedBarSegmentProps = {
  category: BudgetChartCategory
  chartCategories: BudgetChartCategory[]
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  payload?: BudgetChartPoint
}

/**
 * Rounds the top of a stacked segment only when it is the topmost non-zero category in its bar, so
 * each column gets one rounded cap no matter which category happens to sit on top. Applying the
 * radius to a fixed segment instead leaves bars flat-topped whenever that category is empty
 *
 * Every segment always renders its own solid category colour, including the current,
 * still-in-progress period, which is marked only on the X axis rather than inside the bar
 */
export default function StackedBarSegment({
  category,
  chartCategories,
  x,
  y,
  width,
  height,
  fill,
  payload,
}: StackedBarSegmentProps) {
  const topSegment = [...chartCategories]
    .reverse()
    .find((entry) => Number((payload as Record<string, unknown> | undefined)?.[entry.dataKey] ?? 0) > 0)
  const isTopSegment = topSegment?.id === category.id

  return (
    <BudgetUtilizationBar x={x} y={y} width={width} height={height} fill={fill} roundTop={isTopSegment} />
  )
}
