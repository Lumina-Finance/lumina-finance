import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Text,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  type XAxisTickContentProps,
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

// Rounds only the top corners of a utilization bar
const BUDGET_BAR_TOP_CORNER_RADIUS: [number, number, number, number] = [4, 4, 0, 0]

// Default single-category bar fill
const BUDGET_CHART_ACCENT_COLOR = 'var(--app-accent)'

const ARCHIVED_BAND_LABEL = 'ARCHIVED'
const ARCHIVED_BAND_INSET_PX = 10
const ARCHIVED_BAND_MIN_WIDTH_PX = 18
const ARCHIVED_BAND_LABEL_MIN_WIDTH_PX = 52
const ARCHIVED_BAND_LABEL_FONT_SIZE = 10
const ARCHIVED_BAND_FILL_OPACITY = 0.12
const ARCHIVED_BAND_CORNER_RADIUS_PX = 6

// A period is over budget once utilization passes this percentage; archived gap points sit at 0
// and never qualify
const OVER_BUDGET_UTILIZATION_THRESHOLD_PCT = 100

// Fill for the portion of an over-budget bar above the limit line, and the line itself
const OVER_BUDGET_CAP_COLOR = 'var(--app-negative)'
const OVER_BUDGET_LIMIT_LINE_DASH = '5 4'
const OVER_BUDGET_LIMIT_LINE_OPACITY = 0.55

const CURRENT_PERIOD_BOUNDARY_DASH = '3 3'

// Current-period month label on the X axis, and the small dot marking it
const CURRENT_PERIOD_AXIS_TICK_FONT_SIZE = 13
const CURRENT_PERIOD_AXIS_DOT_RADIUS_PX = 2
const CURRENT_PERIOD_AXIS_DOT_OFFSET_PX = 16

// Every other period label renders on mobile, so a wide label like "Jan '26" never sits close
// enough to its neighbour to collide with it
const BUDGET_CHART_MOBILE_AXIS_LABEL_STEP = 2

// At or below this many points, bands are wide enough that even the year label fits without
// colliding, so mobile shows every label just like desktop instead of thinning them out
const BUDGET_CHART_MOBILE_FULL_LABEL_MAX_POINTS = 6

type ArchivedChartStretch = {
  firstKey: string
  lastKey: string
}

/**
 * Groups consecutive archived chart columns into contiguous stretches so a multi-step gap renders
 * as one spanning shaded band instead of one band per column
 */
function getArchivedChartStretches(chartData: BudgetChartPoint[]): ArchivedChartStretch[] {
  const stretches: ArchivedChartStretch[] = []
  let runStart: string | null = null
  let runEnd: string | null = null

  chartData.forEach((point) => {
    if (point.archived) {
      if (runStart === null) runStart = point.periodKey
      runEnd = point.periodKey
      return
    }

    if (runStart !== null && runEnd !== null) stretches.push({ firstKey: runStart, lastKey: runEnd })
    runStart = null
    runEnd = null
  })

  if (runStart !== null && runEnd !== null) stretches.push({ firstKey: runStart, lastKey: runEnd })

  return stretches
}

/**
 * Picks which chart points keep an X-axis label on mobile, thinning a full window down to an evenly
 * spaced subset so a wide label like "Jan '26" never sits close enough to a neighbour to collide
 *
 * Returns null when there are few enough points that every label already fits, meaning show all of
 * them. Otherwise the subset is spaced every {@link BUDGET_CHART_MOBILE_AXIS_LABEL_STEP} points,
 * anchored on the first period whose label carries the year suffix so that label is never the one
 * skipped, falling back to the current period and then the last point when no period starts in
 * January. The current period's key is always added on top of the spacing so the in-progress period
 * never loses its accent label and dot
 */
function getMobileAxisLabelKeys(chartData: BudgetChartPoint[]): Set<string> | null {
  if (chartData.length <= BUDGET_CHART_MOBILE_FULL_LABEL_MAX_POINTS) return null

  const yearLabelIndex = chartData.findIndex((point) => point.hasYearAxisLabel)
  const currentPeriodIndex = chartData.findIndex((point) => point.isCurrent)
  const anchorIndex = yearLabelIndex >= 0 ? yearLabelIndex : currentPeriodIndex >= 0 ? currentPeriodIndex : chartData.length - 1

  const labelKeys = new Set(
    chartData
      .filter((_, index) => (index - anchorIndex) % BUDGET_CHART_MOBILE_AXIS_LABEL_STEP === 0)
      .map((point) => point.periodKey),
  )

  if (currentPeriodIndex >= 0) labelKeys.add(chartData[currentPeriodIndex].periodKey)

  return labelKeys
}

/**
 * Shades every contiguous archived stretch across the full plot height with one spanning band and
 * a single centred label
 *
 * Recharts exposes plot geometry through hooks, so the band is derived from the categorical scale
 * directly instead of measured DOM coordinates, keeping it aligned inside responsive charts
 */
function ArchivedBandsLayer({ stretches }: { stretches: ArchivedChartStretch[] }) {
  const plotArea = usePlotArea()
  const xScale = useXAxisScale() as ((label: string) => number) & { bandwidth?: () => number }
  if (!plotArea || !xScale || stretches.length === 0) return null

  const bandwidth = xScale.bandwidth ? xScale.bandwidth() : 0

  return (
    <g>
      {stretches.map((stretch) => {
        const firstCenter = xScale(stretch.firstKey)
        const lastCenter = xScale(stretch.lastKey)
        if (typeof firstCenter !== 'number' || typeof lastCenter !== 'number') return null

        const leftEdge = firstCenter - bandwidth / 2 + ARCHIVED_BAND_INSET_PX / 2
        const rightEdge = lastCenter + bandwidth / 2 - ARCHIVED_BAND_INSET_PX / 2
        const shadeWidth = Math.max(rightEdge - leftEdge, ARCHIVED_BAND_MIN_WIDTH_PX)
        const shadeCenter = (leftEdge + rightEdge) / 2

        return (
          <g key={`${stretch.firstKey}-${stretch.lastKey}`}>
            <rect
              x={shadeCenter - shadeWidth / 2}
              y={plotArea.y}
              width={shadeWidth}
              height={plotArea.height}
              rx={ARCHIVED_BAND_CORNER_RADIUS_PX}
              fill="var(--app-text-muted)"
              fillOpacity={ARCHIVED_BAND_FILL_OPACITY}
            />
            {shadeWidth >= ARCHIVED_BAND_LABEL_MIN_WIDTH_PX && (
              <text
                x={shadeCenter}
                y={plotArea.y + plotArea.height / 2}
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
      })}
    </g>
  )
}

/**
 * Draws the dashed boundary marking where the current, still-in-progress period begins, mirroring
 * the savings-rate dashboard chart's current-month divider
 *
 * Defined locally rather than reused from the dashboard because the boundary is wired to this
 * chart's period keys; renders nothing once there is no current period in the visible window
 */
function CurrentPeriodBoundary({ currentPeriodKey }: { currentPeriodKey: string | undefined }) {
  const plotArea = usePlotArea()
  const xScale = useXAxisScale() as ((label: string) => number) & { bandwidth?: () => number }
  if (!currentPeriodKey || !plotArea || !xScale) return null

  const center = xScale(currentPeriodKey)
  if (typeof center !== 'number' || !Number.isFinite(center)) return null

  const bandwidth = xScale.bandwidth ? xScale.bandwidth() : 0

  // Category scales report the band center, so use the left edge so the divider marks where the
  // current period begins, not the middle of its bar
  const leftEdge = center - bandwidth / 2

  return (
    <line
      x1={leftEdge}
      x2={leftEdge}
      y1={plotArea.y}
      y2={plotArea.y + plotArea.height}
      stroke="var(--app-text-subtle)"
      strokeDasharray={CURRENT_PERIOD_BOUNDARY_DASH}
      strokeWidth={1}
    />
  )
}

type BudgetChartAxisTickProps = XAxisTickContentProps & {
  currentPeriodKey: string | undefined
}

/**
 * Renders one X-axis month label, matching Recharts' default tick styling unless the label belongs
 * to the current, still-in-progress period
 *
 * Recharts' default tick is itself a `<Text>` positioned from the tick props it computes, so this
 * renders through that same `Text` component rather than a hand-positioned `<text>` — reusing
 * Recharts' own positioning is what keeps the label aligned under its bar. Only the presentational
 * props are forwarded: `payload`, `index`, `visibleTicksCount`, and `tickFormatter` are Recharts-only
 * bookkeeping that `Text` does not accept
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
function BudgetChartAxisTick({ currentPeriodKey, ...tickProps }: BudgetChartAxisTickProps) {
  const { payload, index, visibleTicksCount, tickFormatter, ...textProps } = tickProps
  const value = String((payload as { value?: string | number } | undefined)?.value ?? '')
  const label = tickFormatter ? tickFormatter(value, index) : value
  const isCurrent = value === currentPeriodKey

  return (
    <g>
      <Text
        {...textProps}
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

// The Y axis always shows at least this much so the 100% budget threshold stays on the visible axis
const BUDGET_CHART_MIN_AXIS_MAX_PCT = 100

// Tick step tiers keyed by how tall the tallest bar is, so labels stay round and few (0/25/50/.../100)
// for typical utilization and coarsen as bars run further over budget. Every step evenly divides
// BUDGET_CHART_MIN_AXIS_MAX_PCT, so the 100% threshold always lands on a tick
const BUDGET_CHART_AXIS_TIER_1_MAX_PCT = 100
const BUDGET_CHART_AXIS_TIER_1_STEP_PCT = 25
const BUDGET_CHART_AXIS_TIER_2_MAX_PCT = 250
const BUDGET_CHART_AXIS_TIER_2_STEP_PCT = 50
const BUDGET_CHART_AXIS_TIER_3_STEP_PCT = 100

type BudgetChartAxis = {
  max: number
  ticks: number[]
}

/**
 * Picks a round tick step and axis maximum for the utilization Y axis instead of letting Recharts
 * auto-generate ticks against an arbitrary maximum, which produces uneven labels (such as
 * 45/90/135) rather than clean, evenly spaced ones
 *
 * The maximum is the next multiple of the chosen step strictly above the data, so the tallest bar's
 * rounded top corner keeps headroom against the plot edge
 */
function getBudgetChartAxis(dataMax: number): BudgetChartAxis {
  const effectiveMax = Math.max(dataMax, BUDGET_CHART_MIN_AXIS_MAX_PCT)
  const step =
    effectiveMax <= BUDGET_CHART_AXIS_TIER_1_MAX_PCT
      ? BUDGET_CHART_AXIS_TIER_1_STEP_PCT
      : effectiveMax <= BUDGET_CHART_AXIS_TIER_2_MAX_PCT
        ? BUDGET_CHART_AXIS_TIER_2_STEP_PCT
        : BUDGET_CHART_AXIS_TIER_3_STEP_PCT
  const max = (Math.floor(effectiveMax / step) + 1) * step
  const ticks = Array.from({ length: max / step + 1 }, (_, index) => index * step)

  return { max, ticks }
}

/**
 * Rounds a rectangle's edges to whole pixels rather than rounding its origin and size
 * independently, so the resulting `x`/`y`/`width`/`height` describe the same whole-pixel left,
 * top, right, and bottom edges
 *
 * Stacked bar segments each render as a separate SVG path, and two adjacent segments share their
 * boundary coordinate as the same fractional value. Rounding that shared edge here gives both
 * paths the identical integer pixel row, which removes the anti-aliasing seam and the hairline
 * horizontal offset that fractional coordinates otherwise cause on non-retina displays
 */
function getPixelSnappedRect(x: number, y: number, width: number, height: number) {
  const left = Math.round(x)
  const top = Math.round(y)
  const right = Math.round(x + width)
  const bottom = Math.round(y + height)

  return { x: left, y: top, width: right - left, height: bottom - top }
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
 *
 * Every segment always renders its own solid category colour, including the current,
 * still-in-progress period, which is marked only on the X axis rather than inside the bar
 *
 * The over-budget overflow cap is drawn only by the top segment, sized as a fraction of this
 * segment's own recharts-animated height rather than an absolute plot coordinate, so the cap
 * grows in lockstep with the bar during the entry animation instead of popping in at its final size
 */
function StackedBarSegment({
  category,
  chartCategories,
  x,
  y,
  width,
  height,
  fill,
  payload,
}: StackedBarSegmentProps) {
  const topSegment = [...chartCategories]
    .reverse()
    .find((entry) => Number((payload as Record<string, unknown> | undefined)?.[entry.dataKey] ?? 0) > 0)
  const isTopSegment = topSegment?.id === category.id

  // The top segment's own value is the number of percentage points it contributes to the bar, so
  // the portion of that value sitting above the 100% line is the fraction of the segment's own
  // height the cap must cover
  const wholeBarTopPct = payload ? getBudgetChartBarTopPct(payload, chartCategories, true) : 0
  const topSegmentValue =
    isTopSegment && topSegment && payload
      ? Number((payload as unknown as Record<string, unknown>)[topSegment.dataKey] ?? 0)
      : 0
  const overBudgetFraction =
    topSegmentValue > 0
      ? Math.min(Math.max((wholeBarTopPct - OVER_BUDGET_UTILIZATION_THRESHOLD_PCT) / topSegmentValue, 0), 1)
      : 0

  const hasNumericGeometry = typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number'

  // Snapped once so the segment and its cap share identical rounded edges with each other
  const snappedRect = hasNumericGeometry ? getPixelSnappedRect(x, y, width, height) : null

  return (
    <g>
      <Rectangle
        x={snappedRect?.x ?? x}
        y={snappedRect?.y ?? y}
        width={snappedRect?.width ?? width}
        height={snappedRect?.height ?? height}
        fill={fill}
        radius={isTopSegment ? BUDGET_BAR_TOP_CORNER_RADIUS : 0}
      />
      {overBudgetFraction > 0 && snappedRect && (
        <Rectangle
          x={snappedRect.x}
          y={snappedRect.y}
          width={snappedRect.width}
          height={Math.round(snappedRect.height * overBudgetFraction)}
          fill={OVER_BUDGET_CAP_COLOR}
          radius={BUDGET_BAR_TOP_CORNER_RADIUS}
        />
      )}
    </g>
  )
}

type SingleCategoryBarProps = {
  overBudgetFraction: number
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Renders the single-category utilization bar with its solid accent colour and the red overflow
 * cap covering the portion of the bar above the 100% budget limit
 *
 * Built as a shape component rather than Cell children so the cap can be derived from the bar's
 * own recharts-computed geometry instead of a separately positioned overlay. The cap's height is a
 * fraction of the bar's own animated height rather than an absolute plot coordinate, so it grows in
 * lockstep with the bar during the entry animation instead of popping in at its final size
 */
function SingleCategoryBar({ overBudgetFraction, x, y, width, height }: SingleCategoryBarProps) {
  const hasNumericGeometry = typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number'

  // Snapped once so the bar and its cap share identical rounded edges with each other
  const snappedRect = hasNumericGeometry ? getPixelSnappedRect(x, y, width, height) : null

  return (
    <g>
      <Rectangle
        x={snappedRect?.x ?? x}
        y={snappedRect?.y ?? y}
        width={snappedRect?.width ?? width}
        height={snappedRect?.height ?? height}
        fill={BUDGET_CHART_ACCENT_COLOR}
        radius={BUDGET_BAR_TOP_CORNER_RADIUS}
      />
      {overBudgetFraction > 0 && snappedRect && (
        <Rectangle
          x={snappedRect.x}
          y={snappedRect.y}
          width={snappedRect.width}
          height={Math.round(snappedRect.height * overBudgetFraction)}
          fill={OVER_BUDGET_CAP_COLOR}
          radius={BUDGET_BAR_TOP_CORNER_RADIUS}
        />
      )}
    </g>
  )
}

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
              <CartesianGrid stroke="var(--app-border)" vertical={false} />

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
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 12 }}
                tickFormatter={(value) => `${Number(value)}%`}
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
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                />
              )) : (
                <Bar
                  dataKey="utilizationPct"
                  shape={(props) => {
                    const point = props.payload as BudgetChartPoint | undefined
                    const barTopPct = point ? getBudgetChartBarTopPct(point, chartCategories, false) : 0
                    const overBudgetFraction =
                      barTopPct > OVER_BUDGET_UTILIZATION_THRESHOLD_PCT
                        ? (barTopPct - OVER_BUDGET_UTILIZATION_THRESHOLD_PCT) / barTopPct
                        : 0

                    return <SingleCategoryBar {...props} overBudgetFraction={overBudgetFraction} />
                  }}
                  barSize={barSize}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                />
              )}
              <ReferenceLine
                y={OVER_BUDGET_UTILIZATION_THRESHOLD_PCT}
                stroke={OVER_BUDGET_CAP_COLOR}
                strokeOpacity={OVER_BUDGET_LIMIT_LINE_OPACITY}
                strokeDasharray={OVER_BUDGET_LIMIT_LINE_DASH}
                strokeWidth={1}
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
