import {
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/ChartTooltipContent'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/pages/dashboard/constants/chart'
import type { CashFlowBarBucket } from '@/pages/insights/types/cashFlow'
import { formatSignedCurrency, getSignedAmountColor } from '@/pages/insights/utils/money'
import { formatCurrency } from '@/utils/formatCurrency'

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
 * Sizes the Y axis from formatted currency labels so large values do not clip
 */
function getCashFlowYAxisWidth(buckets: CashFlowBarBucket[], currency: string) {
  const values = buckets.flatMap((bucket) => [bucket.net, 0])
  const longestLabel = values.reduce((longest, value) => {
    const label = formatCurrency(value, currency)
    return label.length > longest.length ? label : longest
  }, '')

  return Math.min(92, Math.max(52, longestLabel.length * 6 + 10))
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
  return (
    <>
      <ChartTooltipTitle>{bucket.rangeLabel}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Net"
        value={formatSignedCurrency(bucket.net, displayCurrency)}
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
export function CashFlowBarChart({
  buckets,
  displayCurrency,
  emptyLabel,
}: CashFlowBarChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<CashFlowBarBucket>>(null)
  const hasActivity = buckets.some((bucket) => bucket.inflow > 0 || bucket.outflow > 0)
  const yAxisWidth = getCashFlowYAxisWidth(buckets, displayCurrency)

  /**
   * Shows the bar tooltip for the active Recharts bucket
   */
  function showTooltip(
    state: CashFlowTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const activeIndex = Number(state.activeTooltipIndex)
    const bucket = Number.isInteger(activeIndex)
      ? buckets[activeIndex]
      : buckets.find((item) => item.label === String(state.activeLabel))
    const pointer = getCashFlowTooltipPointer(state, event)
    if (!bucket) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(bucket, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div
      ref={chartRef}
      className="relative min-h-0 flex-1"
      onMouseLeave={hideTooltip}
    >
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
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={32}
              tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
              tickMargin={4}
            />
            <YAxis
              width={yAxisWidth}
              axisLine={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
              tickLine={false}
              domain={[
                (dataMin: number) => Math.min(dataMin, 0),
                (dataMax: number) => Math.max(dataMax, 0),
              ]}
              tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
              tickFormatter={(value) => formatCurrency(Number(value), displayCurrency)}
            />
            <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
            <Bar dataKey="net" radius={4} maxBarSize={40}>
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
          renderContent={(bucket) => (
            <CashFlowBarTooltipContent
              bucket={bucket}
              displayCurrency={displayCurrency}
            />
          )}
        />
      )}
    </div>
  )
}
