import { useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { SpendingRange } from '@/api/dashboard'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/dashboard/constants/chart'
import type { SpendingComparisonSeriesPoint } from '@/dashboard/types/dashboard'
import { SpendingComparisonTooltipContent } from './SpendingComparisonTooltipContent'
import {
  getSpendingComparisonTooltipKey,
  getSpendingComparisonTooltipPointer,
  getSpendingComparisonTooltipPoint,
  type SpendingComparisonTooltipState,
} from '@/dashboard/utils/spendingComparisonTooltip'

type SpendingComparisonChartProps = {
  data: SpendingComparisonSeriesPoint[]
  pointsByLabel: Map<string, SpendingComparisonSeriesPoint>
  xAxisTicks: string[]
  firstXAxisTick: string | undefined
  lastXAxisTick: string | undefined
  displayCurrency: string
  spendingRange: SpendingRange
}

type SpendingComparisonXAxisTickProps = {
  x?: number | string
  y?: number | string
  payload?: {
    value?: number | string
  }
  firstLabel?: string
  lastLabel?: string
}

const spendingComparisonChartMargin = { top: 4, right: 4, bottom: 0, left: 4 } as const

/**
 * Edge-aligns the first and last chart labels so they stay inside the widget bounds
 */
function SpendingComparisonXAxisTick({
  x = 0,
  y = 0,
  payload,
  firstLabel,
  lastLabel,
}: SpendingComparisonXAxisTickProps) {
  const value = String(payload?.value ?? '')
  const textAnchor = value === firstLabel ? 'start' : value === lastLabel ? 'end' : 'middle'

  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={12}
      textAnchor={textAnchor}
      fill="var(--app-text-subtle)"
      fontSize={DASHBOARD_X_AXIS_TICK_FONT_SIZE}
    >
      {value}
    </text>
  )
}

/**
 * Renders the spending comparison area chart and owns its cursor tooltip wiring
 */
export function SpendingComparisonChart({
  data,
  pointsByLabel,
  xAxisTicks,
  firstXAxisTick,
  lastXAxisTick,
  displayCurrency,
  spendingRange,
}: SpendingComparisonChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<SpendingComparisonSeriesPoint>>(null)

  /**
   * Shows a tooltip only when Recharts resolves a point with current or previous values
   */
  function showTooltip(
    state: SpendingComparisonTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getSpendingComparisonTooltipPoint(state, data, pointsByLabel)
    const pointer = getSpendingComparisonTooltipPointer(state, event)

    if (!point || (point.current == null && point.previous == null)) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div
      ref={chartRef}
      className="relative min-h-0 flex-1"
      onMouseLeave={hideTooltip}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={spendingComparisonChartMargin}
          onMouseMove={(state, event) => showTooltip(state, event)}
          onMouseLeave={hideTooltip}
        >
          <defs>
            <linearGradient id="spendCurrentFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--app-accent)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="spendPreviousFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--app-text-muted)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--app-text-muted)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            xAxisId="plot"
            dataKey="label"
            hide
          />
          <XAxis
            xAxisId="labels"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={0}
            ticks={xAxisTicks}
            tick={(props) => (
              <SpendingComparisonXAxisTick
                {...props}
                firstLabel={firstXAxisTick}
                lastLabel={lastXAxisTick}
              />
            )}
            tickMargin={4}
          />
          <YAxis hide />
          <Area
            xAxisId="plot"
            type="monotone"
            dataKey="previous"
            stroke="var(--app-text-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="url(#spendPreviousFill)"
            connectNulls={false}
          />
          <Area
            xAxisId="plot"
            type="monotone"
            dataKey="current"
            stroke="var(--app-accent)"
            strokeWidth={2.5}
            fill="url(#spendCurrentFill)"
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <DeferredChartTooltipOverlay
        ref={tooltipRef}
        chartRef={chartRef}
        className="min-w-48"
        getKey={getSpendingComparisonTooltipKey}
        renderContent={(point) => (
          <SpendingComparisonTooltipContent
            point={point}
            displayCurrency={displayCurrency}
            spendingRange={spendingRange}
          />
        )}
      />
    </div>
  )
}
