import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/TooltipContent'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredTooltipOverlay'
import { getChartDataSignature, useChartEntranceAnimation } from '@/components/charts/useChartEntranceAnimation'
import { CHART_X_AXIS_TICK_FONT_SIZE } from '@/components/charts/constants'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type { CashFlowBarBucket } from '@/pages/insights/types/cashFlow'
import { getCashFlowTooltipBucket } from '@/pages/insights/utils/cashFlow'
import { getCashFlowAxisTicks } from '@/pages/insights/utils/cashFlowAxis'
import { getYearAxisTicks } from '@/utils/chartYearAxis'
import { getSignedAmountColor } from '@/utils/negativeAmount'
import {
  useFittedYAxisWidth,
  Y_AXIS_LABEL_CLASS_NAME,
  Y_AXIS_TICK_MARGIN_PX,
  Y_AXIS_TICK_SIZE_PX,
} from '@/pages/insights/hooks/useFittedYAxisWidth'

type CashFlowTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
}

type CashFlowBarChartProps = {
  buckets: CashFlowBarBucket[]
  displayCurrency: string
  emptyLabel: string
}

const cashFlowChartMargin = { top: 8, right: 0, bottom: 0, left: 0 } as const

function getCashFlowTooltipKey(bucket: CashFlowBarBucket) {
  return bucket.rangeLabel
}

/**
 * Resolves the pointer anchor used by the deferred chart tooltip overlay
 */
function getCashFlowTooltipPointer(
  state: CashFlowTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

/**
 * Renders the shared tooltip content for a cash flow bar
 */
function CashFlowBarTooltipContent({
  bucket,
  displayCurrency,
}: {
  bucket: CashFlowBarBucket
  displayCurrency: string
}) {
  const { formatCurrency, formatMovedCurrency } = useMoneyFormatters()

  return (
    <>
      <ChartTooltipTitle>{bucket.rangeLabel}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Net"
        value={formatMovedCurrency(bucket.net, displayCurrency)}
        valueStyle={{ color: getSignedAmountColor(bucket.net) }}
        financialValue
      />
      <ChartTooltipRow
        label="Inflow"
        value={formatCurrency(bucket.inflow, displayCurrency)}
        valueStyle={{ color: 'var(--app-positive)' }}
        financialValue
      />
      <ChartTooltipRow
        label="Outflow"
        value={formatCurrency(bucket.outflow, displayCurrency)}
        valueStyle={{ color: 'var(--app-negative)' }}
        financialValue
      />
    </>
  )
}

/**
 * Renders the cash flow bar chart and owns pointer-based tooltip behaviour
 */
export function CashFlowBarChart({ buckets, displayCurrency, emptyLabel }: CashFlowBarChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<CashFlowBarBucket>>(null)
  const { formatMovedCurrency } = useMoneyFormatters()
  const hasActivity = buckets.some((bucket) => bucket.inflow > 0 || bucket.outflow > 0)
  const axisTicks = useMemo(() => getCashFlowAxisTicks(buckets.map((bucket) => bucket.net)), [buckets])
  const yAxisWidth = useFittedYAxisWidth(chartRef)
  const [chartWidth, setChartWidth] = useState(0)
  // Measured before the first paint, so the labels the chart chooses are the ones it first draws and
  // the axis never shows the library's own labels for a frame and then swaps them
  useLayoutEffect(() => {
    const chart = chartRef.current
    if (!chart) return undefined
    setChartWidth(chart.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setChartWidth(entry.contentRect.width))
    observer.observe(chart)
    return () => observer.disconnect()
  }, [])
  // Recharts thins labels without regard to which one marks the year, so a range over two calendar years
  // names the labels itself, keeping every one that carries the year
  const yearTicks = useMemo(
    () =>
      getYearAxisTicks(
        buckets.map((bucket) => ({ label: bucket.label, key: bucket.rangeLabel, marksYear: bucket.marksYear })),
        chartWidth - yAxisWidth,
      ),
    [buckets, chartWidth, yAxisWidth],
  )
  const axisLabels = useMemo(() => new Map(buckets.map((bucket) => [bucket.rangeLabel, bucket.label])), [buckets])
  const dataSignature = useMemo(() => getChartDataSignature(buckets, (bucket) => bucket.net), [buckets])
  const barEntrance = useChartEntranceAnimation({ dataSignature })

  /**
   * Shows the bar tooltip for the active Recharts bucket
   */
  function showTooltip(state: CashFlowTooltipState, event: ReactMouseEvent<SVGGraphicsElement>) {
    const bucket = getCashFlowTooltipBucket(state, buckets)
    const pointer = getCashFlowTooltipPointer(state, event)
    if (!bucket) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(bucket, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div ref={chartRef} className="relative min-h-0 flex-1" onMouseLeave={hideTooltip}>
      {!hasActivity ? (
        <div
          className="flex h-full w-full items-center justify-center text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {emptyLabel}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={buckets}
            margin={cashFlowChartMargin}
            barCategoryGap="22%"
            onMouseMove={(state, event) => showTooltip(state, event)}
            onMouseLeave={hideTooltip}
          >
            <XAxis
              // The category is the range, which is unique per bar, and the axis writes the shorter label
              dataKey="rangeLabel"
              tickFormatter={(value) => axisLabels.get(String(value)) ?? String(value)}
              axisLine={false}
              tickLine={false}
              ticks={yearTicks}
              interval={yearTicks ? 0 : 'preserveStartEnd'}
              minTickGap={32}
              tick={{ fill: 'var(--app-text-subtle)', fontSize: CHART_X_AXIS_TICK_FONT_SIZE }}
              tickMargin={4}
            />
            <YAxis
              width={yAxisWidth}
              axisLine={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
              tickLine={false}
              domain={[axisTicks[0], axisTicks[axisTicks.length - 1]]}
              ticks={axisTicks}
              tickSize={Y_AXIS_TICK_SIZE_PX}
              tickMargin={Y_AXIS_TICK_MARGIN_PX}
              tick={{ fill: 'var(--app-text-subtle)', fontSize: 11, className: Y_AXIS_LABEL_CLASS_NAME }}
              // The bars are net flows, amounts that moved, so the labels are signed like the headline
              tickFormatter={(value) => formatMovedCurrency(Number(value), displayCurrency)}
            />
            <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
            <Bar dataKey="net" radius={4} maxBarSize={40} {...barEntrance}>
              {buckets.map((bucket) => (
                <Cell
                  key={bucket.rangeLabel}
                  fill={bucket.net >= 0 ? 'var(--app-chart-positive)' : 'var(--app-chart-negative)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {hasActivity && (
        <DeferredChartTooltipOverlay
          ref={tooltipRef}
          chartRef={chartRef}
          className="min-w-48"
          getKey={getCashFlowTooltipKey}
          renderContent={(bucket) => <CashFlowBarTooltipContent bucket={bucket} displayCurrency={displayCurrency} />}
        />
      )}
    </div>
  )
}
