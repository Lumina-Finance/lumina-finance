import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
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
import BudgetChartTooltip, { type BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'
import { MODAL_SURFACE_TRANSITION_MS } from '@/pages/budgets/constants'
import {
  ARCHIVED_SLOT_LABEL_PREFIX,
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  BUDGET_CHART_LAYOUT,
  getBudgetChartGuideMaxWidth,
  type BudgetChartCategory,
} from '@/pages/budgets/utils/budgetDetails'

const CHART_INITIAL_DIMENSION = { width: 1, height: 192 }

// Rounds only the top corners of a utilization bar
const BUDGET_BAR_TOP_CORNER_RADIUS: [number, number, number, number] = [4, 4, 0, 0]

const ARCHIVED_BAND_LABEL = 'ARCHIVED'
const ARCHIVED_BAND_INSET_PX = 10
const ARCHIVED_BAND_MIN_WIDTH_PX = 18
const ARCHIVED_BAND_LABEL_MIN_WIDTH_PX = 52
const ARCHIVED_BAND_LABEL_FONT_SIZE = 10
const ARCHIVED_BAND_FILL_OPACITY = 0.12
const ARCHIVED_BAND_CORNER_RADIUS_PX = 6

type ArchivedBandBackgroundProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: BudgetChartPoint
  bandWidth: number
}

/**
 * Shades an archived chart slot across the full plot height, centring the label when the band is wide enough
 *
 * Recharts supplies the bar geometry and the full-height background rectangle, so the band is centred on the
 * slot and then widened to the categorical band size that the hover guide already relies on
 */
function ArchivedBandBackground({ x, y, width, height, payload, bandWidth }: ArchivedBandBackgroundProps) {
  if (!payload?.archived || x == null || y == null || width == null || height == null) {
    return null
  }

  const slotCenter = x + width / 2
  const shadeWidth = Math.max(bandWidth - ARCHIVED_BAND_INSET_PX, ARCHIVED_BAND_MIN_WIDTH_PX)

  return (
    <g>
      <rect
        x={slotCenter - shadeWidth / 2}
        y={y}
        width={shadeWidth}
        height={height}
        rx={ARCHIVED_BAND_CORNER_RADIUS_PX}
        fill="var(--app-text-muted)"
        fillOpacity={ARCHIVED_BAND_FILL_OPACITY}
      />
      {shadeWidth >= ARCHIVED_BAND_LABEL_MIN_WIDTH_PX && (
        <text
          x={slotCenter}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--app-text-subtle)"
          fontSize={ARCHIVED_BAND_LABEL_FONT_SIZE}
          fontWeight={600}
          letterSpacing={1.5}
        >
          {ARCHIVED_BAND_LABEL}
        </text>
      )}
    </g>
  )
}

/**
 * Rounds the axis maximum up to the next multiple of 25 strictly above the data, so a bar that lands
 * on a multiple of 25 (such as exactly 100 percent) keeps a little headroom and its rounded top
 * corner is not flattened against the plot edge
 */
function getBudgetChartAxisMax(dataMax: number): number {
  return Math.max(100, (Math.floor(dataMax / 25) + 1) * 25)
}

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
 */
function StackedBarSegment({ category, chartCategories, x, y, width, height, fill, payload }: StackedBarSegmentProps) {
  const topSegment = [...chartCategories]
    .reverse()
    .find((entry) => Number((payload as Record<string, unknown> | undefined)?.[entry.dataKey] ?? 0) > 0)
  const isTopSegment = topSegment?.id === category.id

  return <Rectangle x={x} y={y} width={width} height={height} fill={fill} radius={isTopSegment ? BUDGET_BAR_TOP_CORNER_RADIUS : 0} />
}

type BudgetHistoryChartProps = {
  chartData: BudgetChartPoint[]
  chartCategories: BudgetChartCategory[]
  currency: string
  loading: boolean
  error: boolean
}

function getBudgetChartTooltipKey(point: BudgetChartPoint) {
  return point.label
}

/**
 * Renders the budget details historical utilization chart and its deferred tooltip
 */
export default function BudgetHistoryChart({
  chartData,
  chartCategories,
  currency,
  loading,
  error,
}: BudgetHistoryChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<BudgetChartPoint>>(null)
  const showStackedCategoryChart = chartCategories.length > 1
  const [measuredChartWidth, setMeasuredChartWidth] = useState(0)
  const hasArchivedSlots = chartData.some((point) => point.archived)

  // Track the plot width so archived bands match the categorical band size recharts renders
  useEffect(() => {
    const element = chartRef.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      setMeasuredChartWidth(entries[0].contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const archivedBandWidth = getBudgetChartGuideMaxWidth(measuredChartWidth, chartData.length)
  const renderArchivedBand = hasArchivedSlots
    ? (props: Omit<ArchivedBandBackgroundProps, 'bandWidth'>) => (
        <ArchivedBandBackground {...props} bandWidth={archivedBandWidth} />
      )
    : undefined

  /**
   * Resolves the hovered Recharts bar and forwards it to the shared deferred tooltip overlay
   */
  function showTooltip(
    state: RechartsTooltipState<BudgetChartPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getRechartsTooltipPoint({
      state,
      data: chartData,
      resolveLabel: (label) => chartData.find((item) => item.label === label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

    // Archived slots are shaded gaps rather than periods, so they never surface a utilization tooltip
    if (!point || point.archived) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div
      ref={chartRef}
      className="relative h-48 min-[750px]:h-80"
      onMouseLeave={hideTooltip}
    >
      {loading ? (
        <div
          className="flex h-full items-center justify-center rounded-xl"
          style={{ background: 'var(--app-bg)' }}
        >
          <div className="app-spinner" />
        </div>
      ) : error ? (
        <div
          className="flex h-full items-center justify-center rounded-xl text-sm"
          style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}
        >
          Utilization history could not load.
        </div>
      ) : chartData.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
            <BarChart
              data={chartData}
              margin={BUDGET_CHART_LAYOUT.margin}
              onMouseMove={(state, event) => showTooltip(state, event)}
              onMouseLeave={hideTooltip}
            >
              <CartesianGrid stroke="var(--app-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 13 }}
                tickFormatter={(label: string) => (label.startsWith(ARCHIVED_SLOT_LABEL_PREFIX) ? '' : label)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={[0, getBudgetChartAxisMax]}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 12 }}
                tickFormatter={(value) => `${Number(value)}%`}
                width={BUDGET_CHART_LAYOUT.yAxisWidth}
              />
              {showStackedCategoryChart ? chartCategories.map((category, index) => (
                <Bar
                  key={category.id}
                  dataKey={category.dataKey}
                  stackId="category-spending"
                  fill={category.color}
                  shape={(props) => <StackedBarSegment {...props} category={category} chartCategories={chartCategories} />}
                  background={index === 0 ? renderArchivedBand : undefined}
                  barSize={28}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                />
              )) : (

                // A custom shape keeps recharts from dropping the zero-height archived columns that carry the background band
                <Bar
                  dataKey="utilizationPct"
                  fill="var(--app-accent)"
                  shape={({ x, y, width, height, fill }) => (
                    <Rectangle x={x} y={y} width={width} height={height} fill={fill} radius={BUDGET_BAR_TOP_CORNER_RADIUS} />
                  )}
                  background={renderArchivedBand}
                  barSize={28}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
          <DeferredChartTooltipOverlay
            ref={tooltipRef}
            chartRef={chartRef}
            className="min-w-44"
            guideVariant="bar"
            guideWidth={BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH}
            guideMaxWidth={(chartWidth) => getBudgetChartGuideMaxWidth(chartWidth, chartData.length)}
            getKey={getBudgetChartTooltipKey}
            renderContent={(point) => (
              <BudgetChartTooltip
                point={point}
                currency={currency}
              />
            )}
          />
        </>
      ) : (
        <div
          className="flex h-full items-center justify-center rounded-xl text-sm"
          style={{ background: 'var(--app-bg)', color: 'var(--app-text-subtle)' }}
        >
          No utilization history yet.
        </div>
      )}
    </div>
  )
}
