import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/ChartTooltipContent'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import {
  DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
  DASHBOARD_NET_WORTH_X_AXIS_TICK_COUNT,
  DASHBOARD_X_AXIS_TICK_FONT_SIZE,
} from '@/pages/dashboard/constants/chart'
import type { NetWorthSeriesPoint } from '@/pages/dashboard/types/dashboard'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import { formatCurrency } from '@/utils/formatCurrency'

type NetWorthChartProps = {
  data: NetWorthSeriesPoint[]
  displayCurrency: string
}

type NetWorthTooltipTarget = {
  point: NetWorthSeriesPoint
  chartX: number
}

const netWorthChartMargin = { top: 4, right: 4, bottom: 0, left: 4 } as const

/**
 * Selects evenly spaced x-axis labels while preserving the first and last dates
 */
function getNetWorthXAxisTicks(data: NetWorthSeriesPoint[]) {
  const tickCount = Math.min(DASHBOARD_NET_WORTH_X_AXIS_TICK_COUNT, data.length)
  if (tickCount <= 1) return data.map((point) => point.date)

  const lastIndex = data.length - 1
  return Array.from({ length: tickCount }, (_, index) => (
    data[Math.round((lastIndex * index) / (tickCount - 1))].date
  ))
}

/**
 * Renders the net worth point details inside the cursor tooltip
 */
function NetWorthTooltipContent({
  point,
  displayCurrency,
}: {
  point: NetWorthSeriesPoint
  displayCurrency: string
}) {
  return (
    <>
      <ChartTooltipTitle>{point.date}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Net Worth"
        value={formatCurrency(point.value, displayCurrency)}
        financialValue
      />
    </>
  )
}

/**
 * Finds the nearest point from raw cursor position when Recharts does not provide an active point
 */
function getNetWorthTooltipTargetFromCursor(
  clientX: number,
  chart: HTMLDivElement | null,
  data: NetWorthSeriesPoint[],
): NetWorthTooltipTarget | undefined {
  const rect = chart?.getBoundingClientRect()
  if (!rect || data.length === 0) return undefined

  const plotLeft = netWorthChartMargin.left
  const plotWidth = Math.max(rect.width - netWorthChartMargin.left - netWorthChartMargin.right, 1)
  const ratio = Math.min(Math.max((clientX - rect.left - plotLeft) / plotWidth, 0), 1)
  const index = data.length === 1 ? 0 : Math.round(ratio * (data.length - 1))
  const chartX = plotLeft + (data.length === 1 ? 0 : (plotWidth * index) / (data.length - 1))

  return {
    point: data[index],
    chartX,
  }
}

/**
 * Uses the visible net worth trend to choose the chart line colour
 */
function getNetWorthLineColor(data: NetWorthSeriesPoint[]) {
  const netWorthTrendUp =
    data.length >= 2 &&
    data[data.length - 1].value >= data[0].value

  return netWorthTrendUp ? 'var(--app-positive)' : 'var(--app-negative)'
}

/**
 * Renders the dashboard net worth line chart and owns tooltip resolution
 */
export function NetWorthChart({ data, displayCurrency }: NetWorthChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<NetWorthSeriesPoint>>(null)
  const xAxisTicks = useMemo(
    () => getNetWorthXAxisTicks(data),
    [data],
  )
  const pointsByDate = useMemo(
    () => new Map(data.map((point) => [point.date, point])),
    [data],
  )
  const lineColor = getNetWorthLineColor(data)

  /**
   * Shows the closest net worth point when Recharts gives only partial cursor state
   */
  function showTooltip(
    state: RechartsTooltipState<NetWorthSeriesPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const fallbackTarget = getNetWorthTooltipTargetFromCursor(event.clientX, chartRef.current, data)
    const point = getRechartsTooltipPoint({
      state,
      data,
      resolveLabel: (label) => pointsByDate.get(label),
    }) ?? fallbackTarget?.point
    const pointer = {
      ...getRechartsTooltipPointer(state, event),
      chartX: typeof state.activeCoordinate?.x === 'number'
        ? state.activeCoordinate.x
        : fallbackTarget?.chartX,
    }

    if (!point) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div
      ref={chartRef}
      className="relative mt-3 min-h-0 flex-1"
      onMouseLeave={hideTooltip}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={netWorthChartMargin}
          onMouseMove={(state, event) => showTooltip(state, event)}
          onMouseLeave={hideTooltip}
        >
          <XAxis
            xAxisId="plot"
            dataKey="date"
            hide
          />
          <XAxis
            xAxisId="labels"
            dataKey="date"
            axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
            tickLine={false}
            interval={0}
            ticks={xAxisTicks}
            padding={{
              left: DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
              right: DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
            }}
            tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
            tickMargin={3}
          />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            xAxisId="plot"
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <DeferredChartTooltipOverlay
        ref={tooltipRef}
        chartRef={chartRef}
        className="min-w-44"
        getKey={(point) => point.date}
        showGuide={false}
        renderContent={(point) => (
          <NetWorthTooltipContent
            point={point}
            displayCurrency={displayCurrency}
          />
        )}
      />
    </div>
  )
}
