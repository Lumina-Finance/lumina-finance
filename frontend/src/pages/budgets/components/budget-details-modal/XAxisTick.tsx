import { Text, type XAxisTickContentProps } from 'recharts'

// Current-period month label on the X axis, and the small dot marking it
const CURRENT_PERIOD_AXIS_TICK_FONT_SIZE = 13
const CURRENT_PERIOD_AXIS_DOT_RADIUS_PX = 2
const CURRENT_PERIOD_AXIS_DOT_OFFSET_PX = 16

type BudgetChartAxisTickProps = XAxisTickContentProps & {
  currentPeriodKey: string | undefined
}

/**
 * Renders one X-axis month label, matching Recharts' default tick styling unless the label belongs
 * to the current, still-in-progress period
 *
 * Recharts' default tick is itself a `<Text>` positioned from the tick props it computes, so this
 * renders through that same `Text` component rather than a hand-positioned `<text>`, reusing
 * Recharts' own positioning to keep the label aligned under its bar. The full tick props are
 * forwarded because `Text` filters out the Recharts-only bookkeeping (`payload`, `index`,
 * `visibleTicksCount`, `tickFormatter`) before anything reaches the DOM
 *
 * The label text itself comes from calling that same `tickFormatter` rather than a separately
 * looked-up map. Recharts also calls the formatter to measure and lay out ticks, so deriving the
 * rendered text from it keeps what's drawn in sync with what Recharts measured — including on
 * mobile, where the formatter empties out the labels thinned out of the visible subset, so a
 * skipped label measures zero width and can't crowd out a kept one
 *
 * The current month is marked here rather than inside the bar itself: the label renders in the
 * accent colour and bold, with a small accent dot underneath so the in-progress period reads at a
 * glance without altering the bar's own solid fill
 */
export default function BudgetChartAxisTick({ currentPeriodKey, ...tickProps }: BudgetChartAxisTickProps) {
  const value = String((tickProps.payload as { value?: string | number } | undefined)?.value ?? '')
  const label = tickProps.tickFormatter ? tickProps.tickFormatter(value, tickProps.index) : value
  const isCurrent = value === currentPeriodKey

  return (
    <g>
      <Text
        {...tickProps}
        fill={isCurrent ? 'var(--app-accent)' : 'var(--app-text-subtle)'}
        fontSize={CURRENT_PERIOD_AXIS_TICK_FONT_SIZE}
        fontWeight={isCurrent ? 700 : 400}
      >
        {label}
      </Text>
      {isCurrent && (
        <circle
          cx={Number(tickProps.x)}
          cy={Number(tickProps.y) + CURRENT_PERIOD_AXIS_DOT_OFFSET_PX}
          r={CURRENT_PERIOD_AXIS_DOT_RADIUS_PX}
          fill="var(--app-accent)"
        />
      )}
    </g>
  )
}
