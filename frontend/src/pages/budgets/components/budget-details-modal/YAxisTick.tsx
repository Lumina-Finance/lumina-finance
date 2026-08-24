import { Text, type YAxisTickContentProps } from 'recharts'
import {
  OVER_BUDGET_LIMIT_LABEL_COLOR,
  OVER_BUDGET_LIMIT_LINE_PCT,
} from '@/pages/budgets/components/budget-details-modal/budgetChartAxis'

// Font size shared by every Y-axis utilization label
const BUDGET_CHART_Y_AXIS_TICK_FONT_SIZE = 12

/**
 * Renders one Y-axis utilization label, matching the default tick styling unless it is the 100%
 * budget limit, which is drawn red and bold so the label reads together with the dashed line
 * crossing the plot at the same height. The two reds differ, since one is text and one is a mark
 *
 * Recharts' default tick is a `<Text>` positioned from the tick props it computes, so this renders
 * through that same component to keep the label aligned with its gridline. The full tick props are
 * forwarded because `Text` filters out the Recharts-only bookkeeping props before they reach the DOM
 */
export default function BudgetChartYAxisTick(tickProps: YAxisTickContentProps) {
  const value = Number((tickProps.payload as { value?: number } | undefined)?.value ?? 0)
  const isLimit = value === OVER_BUDGET_LIMIT_LINE_PCT

  return (
    <Text
      {...tickProps}
      fill={isLimit ? OVER_BUDGET_LIMIT_LABEL_COLOR : 'var(--app-text-subtle)'}
      fontSize={BUDGET_CHART_Y_AXIS_TICK_FONT_SIZE}
      fontWeight={isLimit ? 700 : 400}
    >
      {`${value}%`}
    </Text>
  )
}
