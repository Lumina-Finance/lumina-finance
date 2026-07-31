import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import ArchivedBandsLayer from '@/pages/budgets/components/budget-details-modal/ArchivedBands'
import { getArchivedChartStretches } from '@/pages/budgets/components/budget-details-modal/archivedStretches'
import {
  getBudgetChartAxis,
  getMobileAxisLabelKeys,
} from '@/pages/budgets/components/budget-details-modal/budgetChartAxis'
import BudgetChartTooltip, { type BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'
import CurrentPeriodBoundary from '@/pages/budgets/components/budget-details-modal/CurrentPeriodBoundary'
import StackedBarSegment from '@/pages/budgets/components/budget-details-modal/StackedBarSegment'
import BudgetUtilizationBar from '@/pages/budgets/components/budget-details-modal/UtilizationBar'
import BudgetChartAxisTick from '@/pages/budgets/components/budget-details-modal/XAxisTick'
import BudgetChartYAxisTick, {
  OVER_BUDGET_LIMIT_LINE_COLOR,
  OVER_BUDGET_LIMIT_LINE_PCT,
} from '@/pages/budgets/components/budget-details-modal/YAxisTick'
import { MODAL_SURFACE_TRANSITION_MS } from '@/pages/budgets/constants'
import {
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  BUDGET_CHART_LAYOUT,
  getBudgetChartBarTopPct,
  getBudgetChartGuideMaxWidth,
  type BudgetChartCategory,
} from '@/pages/budgets/utils/budgetDetails'

const CHART_INITIAL_DIMENSION = { width: 1, height: 211 }

// Pixel width shared by both the single-category bar and every stacked category segment, narrower
// on mobile so bars don't crowd out the gaps between periods on small screens
const BUDGET_BAR_SIZE_DESKTOP = 28
const BUDGET_BAR_SIZE_MOBILE = 18

// Matches the chart's own min-[750px] height breakpoint, so bar width and chart height switch at
// the same viewport size
const BUDGET_CHART_MOBILE_QUERY = '(max-width: 749.98px)'

// Narrower than the desktop y-axis width so the utilization labels sit closer to the plot on
// mobile, nudging them left toward the "Historical utilization" heading above
const BUDGET_CHART_Y_AXIS_WIDTH_MOBILE = 38

// Drops the plot's right margin to 0 on mobile so its right edge lines up with the period
// history rows below, which reach the section's full width
const BUDGET_CHART_MOBILE_RIGHT_MARGIN = 0

// Default single-category bar fill
const BUDGET_CHART_ACCENT_COLOR = 'var(--app-accent)'

// Dash pattern, opacity and stroke width of the dashed budget-limit line. Its percentage and
// colour live with the Y-axis tick, which reuses them to bold its own label
const OVER_BUDGET_LIMIT_LINE_DASH = '5 4'
const OVER_BUDGET_LIMIT_LINE_OPACITY = 0.55
const OVER_BUDGET_LIMIT_LINE_WIDTH = 2

type BudgetHistoryChartProps = {
  chartData: BudgetChartPoint[]
  chartCategories: BudgetChartCategory[]
  currency: string
  loading: boolean
  error: boolean
}

function getBudgetChartTooltipKey(point: BudgetChartPoint) {
  return point.periodKey
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
  const archivedStretches = getArchivedChartStretches(chartData)
  const tickLabels = new Map(chartData.map((point) => [point.periodKey, point.axisLabel]))
  const currentPeriodKey = chartData.find((point) => point.isCurrent)?.periodKey
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(BUDGET_CHART_MOBILE_QUERY).matches)

  // Recharts keys a bar's animation off the identity of the rectangles it computes, and that identity
  // changes on every render, so an animated bar replays its entrance whenever anything re-renders the
  // chart. Pointer movement re-renders it on every event, which leaves the plot repainting frame by
  // frame for as long as the pointer keeps moving. Animation is therefore switched off as soon as the
  // entrance has played, leaving the bars static for the rest of the chart's life
  const [barsAnimating, setBarsAnimating] = useState(true)
  const stopBarAnimation = () => setBarsAnimating(false)

  useEffect(() => {
    const mobileQuery = window.matchMedia(BUDGET_CHART_MOBILE_QUERY)
    const updateIsMobile = () => setIsMobile(mobileQuery.matches)

    mobileQuery.addEventListener('change', updateIsMobile)
    return () => mobileQuery.removeEventListener('change', updateIsMobile)
  }, [])

  const barSize = isMobile ? BUDGET_BAR_SIZE_MOBILE : BUDGET_BAR_SIZE_DESKTOP
  const yAxisWidth = isMobile ? BUDGET_CHART_Y_AXIS_WIDTH_MOBILE : BUDGET_CHART_LAYOUT.yAxisWidth
  const chartMargin = {
    ...BUDGET_CHART_LAYOUT.margin,
    right: isMobile ? BUDGET_CHART_MOBILE_RIGHT_MARGIN : BUDGET_CHART_LAYOUT.margin.right,
  }

  // Desktop always shows every period's label; only mobile ever thins the axis down to a subset
  const mobileAxisLabelKeys = isMobile ? getMobileAxisLabelKeys(chartData) : null

  // Picks the Y axis domain and tick step from the tallest bar recharts will actually draw
  const dataMax = chartData
    .filter((point) => !point.archived)
    .reduce((max, point) => Math.max(max, getBudgetChartBarTopPct(point, chartCategories, showStackedCategoryChart)), 0)
  const { max: axisMax, ticks: axisTicks } = getBudgetChartAxis(dataMax)

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
      resolveLabel: (label) => chartData.find((item) => item.periodKey === label),
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
      className="relative h-[15.84rem] min-[750px]:h-[22rem]"
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
              margin={chartMargin}
              onMouseMove={(state, event) => showTooltip(state, event)}
              onMouseLeave={hideTooltip}
            >
              {/*
                syncWithTicks keeps grid lines only on the Y-axis ticks, so recharts does not add a
                stray line at the domain top which now sits a little above the highest labelled tick
              */}
              <CartesianGrid stroke="var(--app-border)" vertical={false} syncWithTicks />

              {/*
                recharts measures the rendered tick value to size and position ticks, so without a
                formatter it measures the raw periodKey date string instead of the short label the
                custom tick actually draws, and shifts the last tick inward to avoid clipping a width
                it never renders. The formatter doubles as the mobile thinning mechanism: outside the
                mobile label subset it returns '' instead of the short label, so a skipped tick
                measures zero width and can never collide with or crowd out a kept one. The XAxis
                keeps its default interval throughout — thinning happens only through what the
                formatter returns, never by skipping ticks outright
              */}
              <XAxis
                dataKey="periodKey"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => {
                  const key = String(value)
                  if (mobileAxisLabelKeys && !mobileAxisLabelKeys.has(key)) return ''
                  return tickLabels.get(key) ?? ''
                }}
                tick={(tickProps) => (
                  <BudgetChartAxisTick
                    {...tickProps}
                    currentPeriodKey={currentPeriodKey}
                  />
                )}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={[0, axisMax]}
                ticks={axisTicks}
                tick={(tickProps) => <BudgetChartYAxisTick {...tickProps} />}
                width={yAxisWidth}
              />
              <ArchivedBandsLayer stretches={archivedStretches} />
              <CurrentPeriodBoundary currentPeriodKey={currentPeriodKey} />
              {showStackedCategoryChart ? chartCategories.map((category) => (
                <Bar
                  key={category.id}
                  dataKey={category.dataKey}
                  stackId="category-spending"
                  fill={category.color}
                  shape={(props) => (
                    <StackedBarSegment
                      {...props}
                      category={category}
                      chartCategories={chartCategories}
                    />
                  )}
                  barSize={barSize}
                  isAnimationActive={barsAnimating}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                  onAnimationEnd={stopBarAnimation}
                />
              )) : (
                <Bar
                  dataKey="utilizationPct"
                  shape={(props) => (
                    <BudgetUtilizationBar
                      x={props.x}
                      y={props.y}
                      width={props.width}
                      height={props.height}
                      fill={BUDGET_CHART_ACCENT_COLOR}
                      roundTop
                    />
                  )}
                  barSize={barSize}
                  isAnimationActive={barsAnimating}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                  onAnimationEnd={stopBarAnimation}
                />
              )}
              <ReferenceLine
                y={OVER_BUDGET_LIMIT_LINE_PCT}
                stroke={OVER_BUDGET_LIMIT_LINE_COLOR}
                strokeOpacity={OVER_BUDGET_LIMIT_LINE_OPACITY}
                strokeDasharray={OVER_BUDGET_LIMIT_LINE_DASH}
                strokeWidth={OVER_BUDGET_LIMIT_LINE_WIDTH}
                ifOverflow="extendDomain"
              />
            </BarChart>
          </ResponsiveContainer>
          <DeferredChartTooltipOverlay
            ref={tooltipRef}
            chartRef={chartRef}
            className="min-w-44"
            guideVariant="bar"
            guideWidth={BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH}
            guideMaxWidth={(chartWidth) => getBudgetChartGuideMaxWidth(chartWidth, chartData.length, yAxisWidth)}
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
