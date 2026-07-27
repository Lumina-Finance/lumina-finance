import { Text, type YAxisTickContentProps } from 'recharts'

// The dashed limit line is drawn across the plot at this utilization percentage to mark the
// budget, and the Y-axis tick bolds its label at the same value
export const OVER_BUDGET_LIMIT_LINE_PCT = 100

// Colour of the dashed budget-limit line, reused by the Y-axis tick to colour its label at the
// same threshold
export const OVER_BUDGET_LIMIT_LINE_COLOR = 'var(--app-negative)'

// Font size shared by every Y-axis utilization label
const BUDGET_CHART_Y_AXIS_TICK_FONT_SIZE = 12

/**
 * Renders one Y-axis utilization label, matching the default tick styling unless it is the 100%
 * budget limit, which is drawn in the limit-line colour and bold so the label reads together with
 * the dashed line crossing the plot at the same height
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
      fill={isLimit ? OVER_BUDGET_LIMIT_LINE_COLOR : 'var(--app-text-subtle)'}
      fontSize={BUDGET_CHART_Y_AXIS_TICK_FONT_SIZE}
      fontWeight={isLimit ? 700 : 400}
    >
      {`${value}%`}
    </Text>
  )
}
