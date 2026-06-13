import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredTooltipOverlay'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import { formatUtcAxisDate } from '@/pages/accounts/detail/utils/balanceChartAxis'
import type { BalanceChartPoint } from '@/pages/accounts/detail/utils/balanceChartSeries'
import type {
  BalanceChartDataPoint,
  BalanceChartSnapshot,
} from '@/pages/accounts/detail/utils/balanceChartViewModel'
import { BalanceChartTooltipContent } from './BalanceChartTooltipContent'

const BALANCE_AXIS_EDGE_PADDING_PX = 4

type BalanceChartProps = {
  accountId: string
  snapshot: BalanceChartSnapshot
}

type AxisTickProps = {
  x?: number | string
  y?: number | string
  payload?: {
    value: number | string
  }
}

/**
 * Renders one x-axis tick while preserving first and last label alignment
 */
function BalanceXAxisTick({
  x = 0,
  y = 0,
  payload,
  axisStartMs,
  axisEndMs,
  seriesByDateMs,
}: AxisTickProps & {
  axisStartMs: number
  axisEndMs: number
  seriesByDateMs: Map<number, BalanceChartPoint>
}) {
  const value = Number(payload?.value)
  const textAnchor = value === axisStartMs ? 'start' : value === axisEndMs ? 'end' : 'middle'
  const tickX = Number(x)
  const tickY = Number(y)

  return (
    <text
      x={tickX}
      y={tickY}
      dy={12}
      textAnchor={textAnchor}
      fill="var(--app-text-subtle)"
      fontSize={11}
    >
      {seriesByDateMs.get(value)?.dateLabel ?? formatUtcAxisDate(value)}
    </text>
  )
}

/**
 * Renders the account balance area chart and owns its cursor tooltip wiring
 */
export function BalanceChart({ accountId, snapshot }: BalanceChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<BalanceChartDataPoint>>(null)

  /**
   * Shows the active balance point from Recharts payload, index, or date label fallback
   */
  function showTooltip(
    state: RechartsTooltipState<BalanceChartDataPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getRechartsTooltipPoint({
      state,
      data: snapshot.chartSeries,
      resolveLabel: (label) => {
        const activeDateMs = Number(label)
        return Number.isFinite(activeDateMs)
          ? snapshot.chartSeries.find((entry) => entry.dateMs === activeDateMs)
          : undefined
      },
    })
    const pointer = getRechartsTooltipPointer(state, event)

    if (!point) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  useEffect(() => {
    tooltipRef.current?.hide()
  }, [snapshot.chartMode, snapshot.range])

  return (
    <div
      ref={chartRef}
      className="relative flex-1 min-h-[240px] w-full"
      onMouseLeave={hideTooltip}
    >
      {snapshot.chartSeries.length < 2 ? (
        <div
          className="h-full w-full rounded-lg flex items-center justify-center text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          Not enough history yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={snapshot.chartSeries}
            margin={{
              top: 18,
              right: BALANCE_AXIS_EDGE_PADDING_PX,
              bottom: 0,
              left: BALANCE_AXIS_EDGE_PADDING_PX,
            }}
            onMouseMove={(state, event) => showTooltip(state, event)}
            onMouseLeave={hideTooltip}
          >
            <defs>
              <linearGradient id={`balanceFill-${accountId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={snapshot.chartLineColor} stopOpacity={0.22} />
                <stop offset="100%" stopColor={snapshot.chartLineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dateMs"
              type="number"
              scale="time"
              domain={[snapshot.axisStartMs, snapshot.axisEndMs]}
              ticks={snapshot.xAxisTicks}
              interval={0}
              axisLine={false}
              tickLine={false}
              tick={(props) => (
                <BalanceXAxisTick
                  {...props}
                  axisStartMs={snapshot.axisStartMs}
                  axisEndMs={snapshot.axisEndMs}
                  seriesByDateMs={snapshot.seriesByDateMs}
                />
              )}
              tickMargin={4}
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <ReferenceLine
              y={0}
              stroke="var(--app-text-subtle)"
              strokeDasharray="4 3"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
            <Area
              type="monotone"
              dataKey={snapshot.chartDataKey}
              stroke={snapshot.chartLineColor}
              strokeWidth={2}
              fill={`url(#balanceFill-${accountId})`}
            />
            {snapshot.yearBoundary && (
              <ReferenceLine
                x={snapshot.yearBoundary.dateMs}
                stroke="var(--app-text-muted)"
                strokeDasharray="4 3"
                strokeWidth={1}
                label={{
                  value: snapshot.yearBoundary.year,
                  position: 'top',
                  fill: 'var(--app-text-muted)',
                  fontSize: 11,
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
      {snapshot.chartSeries.length >= 2 && (
        <DeferredChartTooltipOverlay
          ref={tooltipRef}
          chartRef={chartRef}
          className="min-w-44"
          getKey={(point) => `${snapshot.chartMode}:${point.dateMs}`}
          renderContent={(point) => (
            <BalanceChartTooltipContent
              point={point}
              chartMode={snapshot.chartMode}
              currency={snapshot.currency}
            />
          )}
        />
      )}
    </div>
  )
}
