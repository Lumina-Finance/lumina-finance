import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
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
} from '@/components/charts/DeferredTooltipOverlay'
import {
  getChartDataSignature,
  useChartEntranceAnimation,
} from '@/components/charts/useChartEntranceAnimation'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/pages/dashboard/constants/chart'
import type { SpendingComparisonSeriesPoint } from '@/pages/dashboard/types/dashboard'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'

import { SpendingComparisonTooltipContent } from './TooltipContent'

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

  // Both areas are drawn against one shared vertical scale taken from the two series together, so a
  // change in either moves both. One signature and one entrance keeps them animating together
  // rather than leaving the untouched series to jump to its rescaled position
  const dataSignature = useMemo(
    () => getChartDataSignature(data, (point) => `${point.previous}|${point.current}`),
    [data],
  )
  const areasEntrance = useChartEntranceAnimation({ dataSignature })

  /**
   * Shows a tooltip only when Recharts resolves a point with current or previous values
   */
  function showTooltip(
    state: RechartsTooltipState<SpendingComparisonSeriesPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getRechartsTooltipPoint({
      state,
      data,
      resolveLabel: (label) => pointsByLabel.get(label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

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
            {...areasEntrance}
          />
          <Area
            xAxisId="plot"
            type="monotone"
            dataKey="current"
            stroke="var(--app-accent)"
            strokeWidth={2.5}
            fill="url(#spendCurrentFill)"
            connectNulls={false}
            {...areasEntrance}
          />
        </AreaChart>
      </ResponsiveContainer>
      <DeferredChartTooltipOverlay
        ref={tooltipRef}
        chartRef={chartRef}
        className="min-w-48"
        getKey={(point) => point.label}
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
