import { useRef, type MouseEvent as ReactMouseEvent } from 'react'
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
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  BUDGET_CHART_LAYOUT,
  getBudgetChartGuideMaxWidth,
  type BudgetChartCategory,
} from '@/pages/budgets/utils/budgetDetails'

const CHART_INITIAL_DIMENSION = { width: 1, height: 192 }

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

  return <Rectangle x={x} y={y} width={width} height={height} fill={fill} radius={isTopSegment ? [4, 4, 0, 0] : 0} />
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
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={[0, getBudgetChartAxisMax]}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 12 }}
                tickFormatter={(value) => `${Number(value)}%`}
                width={BUDGET_CHART_LAYOUT.yAxisWidth}
              />
              {showStackedCategoryChart ? chartCategories.map((category) => (
                <Bar
                  key={category.id}
                  dataKey={category.dataKey}
                  stackId="category-spending"
                  fill={category.color}
                  shape={(props) => <StackedBarSegment {...props} category={category} chartCategories={chartCategories} />}
                  barSize={28}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                />
              )) : (
                <Bar
                  dataKey="utilizationPct"
                  fill="var(--app-accent)"
                  radius={[4, 4, 0, 0]}
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
