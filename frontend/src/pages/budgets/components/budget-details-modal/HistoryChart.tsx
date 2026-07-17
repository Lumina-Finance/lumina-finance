import { useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
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

const CHART_INITIAL_DIMENSION = { width: 1, height: 192 }

// Pixel width shared by both the single-category bar and every stacked category segment
const BUDGET_BAR_SIZE = 28

// Rounds only the top corners of a utilization bar
const BUDGET_BAR_TOP_CORNER_RADIUS: [number, number, number, number] = [4, 4, 0, 0]

// Default single-category bar fill, reused for both its solid and striped-current variants
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

const CURRENT_PERIOD_STRIPE_PATTERN_ID_PREFIX = 'budget-current-stripes-'
const CURRENT_PERIOD_BOUNDARY_DASH = '3 3'

// Tighter than the savings-widget stripe this pattern was copied from, so a narrow stacked
// category segment still shows a few repeats of the stripe instead of reading as a solid fill
const CURRENT_PERIOD_STRIPE_TILE_PX = 4
const CURRENT_PERIOD_STRIPE_BAND_PX = 2

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

/**
 * Builds a stable colour -> pattern id map over the distinct bar colours actually in use, so every
 * colour gets exactly one striped pattern definition no matter how many bars share it
 */
function getCurrentPeriodStripePatternIds(colors: string[]): Map<string, string> {
  const distinctColors = Array.from(new Set(colors))
  return new Map(distinctColors.map((color, index) => [color, `${CURRENT_PERIOD_STRIPE_PATTERN_ID_PREFIX}${index}`]))
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
 * Converts the 100% budget threshold into the plot's pixel y-coordinate, so the overflow cap can be
 * drawn from a bar's own top down to exactly where the limit line sits rather than by a fixed offset
 */
function getOverBudgetCapTopY(plotArea: { y: number; height: number }, axisMax: number): number {
  return plotArea.y + plotArea.height * (1 - OVER_BUDGET_UTILIZATION_THRESHOLD_PCT / axisMax)
}

type StackedBarSegmentProps = {
  category: BudgetChartCategory
  chartCategories: BudgetChartCategory[]
  currentPeriodStripePatternIds: Map<string, string>
  axisMax: number
  isOverBudget: boolean
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
 * Swaps in the category's striped pattern fill for the current, still-in-progress period so it
 * reads as incomplete without losing its category colour
 *
 * The over-budget overflow cap is drawn only by the top segment, directly from this segment's own
 * x/y/width (the values recharts already computed for this column) down to the 100% line, so it
 * lines up with the bar exactly instead of drifting like a separately positioned overlay
 */
function StackedBarSegment({
  category,
  chartCategories,
  currentPeriodStripePatternIds,
  axisMax,
  isOverBudget,
  x,
  y,
  width,
  height,
  fill,
  payload,
}: StackedBarSegmentProps) {
  const plotArea = usePlotArea()
  const topSegment = [...chartCategories]
    .reverse()
    .find((entry) => Number((payload as Record<string, unknown> | undefined)?.[entry.dataKey] ?? 0) > 0)
  const isTopSegment = topSegment?.id === category.id
  const stripePatternId = currentPeriodStripePatternIds.get(category.color)
  const resolvedFill = payload?.isCurrent && stripePatternId ? `url(#${stripePatternId})` : fill

  return (
    <g>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={resolvedFill}
        radius={isTopSegment ? BUDGET_BAR_TOP_CORNER_RADIUS : 0}
      />
      {isTopSegment && isOverBudget && plotArea && typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && (
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={getOverBudgetCapTopY(plotArea, axisMax) - y}
          fill={OVER_BUDGET_CAP_COLOR}
          radius={BUDGET_BAR_TOP_CORNER_RADIUS}
        />
      )}
    </g>
  )
}

type SingleCategoryBarProps = {
  stripePatternId: string | undefined
  axisMax: number
  isOverBudget: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: BudgetChartPoint
}

/**
 * Renders the single-category utilization bar, swapping in the striped current-period fill the
 * same way the stacked segments do, plus the red overflow cap covering the portion of the bar above
 * the 100% budget limit
 *
 * Built as a shape component rather than Cell children so the cap can be derived from the bar's own
 * recharts-computed geometry instead of a separately positioned overlay
 */
function SingleCategoryBar({ stripePatternId, axisMax, isOverBudget, x, y, width, height, payload }: SingleCategoryBarProps) {
  const plotArea = usePlotArea()
  const fill = payload?.isCurrent && stripePatternId ? `url(#${stripePatternId})` : BUDGET_CHART_ACCENT_COLOR

  return (
    <g>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        radius={BUDGET_BAR_TOP_CORNER_RADIUS}
      />
      {isOverBudget && plotArea && typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && (
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={getOverBudgetCapTopY(plotArea, axisMax) - y}
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
  const currentPeriodStripePatternIds = getCurrentPeriodStripePatternIds(
    showStackedCategoryChart ? chartCategories.map((category) => category.color) : [BUDGET_CHART_ACCENT_COLOR],
  )

  // Mirrors the YAxis domain calculation so the overflow cap's pixel math lines up with the axis
  // recharts actually renders
  const dataMax = chartData
    .filter((point) => !point.archived)
    .reduce((max, point) => Math.max(max, getBudgetChartBarTopPct(point, chartCategories, showStackedCategoryChart)), 0)
  const { max: axisMax, ticks: axisTicks } = getBudgetChartAxis(dataMax)

  // Periods whose plotted bar top clears the budget, used to attach the red overflow cap directly
  // to each bar's own geometry rather than a separately positioned overlay
  const overBudgetPeriodKeys = new Set(
    chartData
      .filter(
        (point) =>
          !point.archived &&
          getBudgetChartBarTopPct(point, chartCategories, showStackedCategoryChart) > OVER_BUDGET_UTILIZATION_THRESHOLD_PCT,
      )
      .map((point) => point.periodKey),
  )

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
          {/* Recharts resolves pattern fills reliably when definitions share the chart SVG context */}
          <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
            <defs>
              {Array.from(currentPeriodStripePatternIds.entries()).map(([color, patternId]) => (
                <pattern
                  key={patternId}
                  id={patternId}
                  patternUnits="userSpaceOnUse"
                  width={CURRENT_PERIOD_STRIPE_TILE_PX}
                  height={CURRENT_PERIOD_STRIPE_TILE_PX}
                  patternTransform="rotate(45)"
                >
                  <rect width={CURRENT_PERIOD_STRIPE_BAND_PX} height={CURRENT_PERIOD_STRIPE_TILE_PX} style={{ fill: color }} />
                </pattern>
              ))}
            </defs>
          </svg>
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
            <BarChart
              data={chartData}
              margin={BUDGET_CHART_LAYOUT.margin}
              onMouseMove={(state, event) => showTooltip(state, event)}
              onMouseLeave={hideTooltip}
            >
              <CartesianGrid stroke="var(--app-border)" vertical={false} />
              <XAxis
                dataKey="periodKey"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 13 }}
                tickFormatter={(value) => tickLabels.get(String(value)) ?? String(value)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={[0, axisMax]}
                ticks={axisTicks}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 12 }}
                tickFormatter={(value) => `${Number(value)}%`}
                width={BUDGET_CHART_LAYOUT.yAxisWidth}
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
                      currentPeriodStripePatternIds={currentPeriodStripePatternIds}
                      axisMax={axisMax}
                      isOverBudget={overBudgetPeriodKeys.has(
                        (props.payload as BudgetChartPoint | undefined)?.periodKey ?? '',
                      )}
                    />
                  )}
                  barSize={BUDGET_BAR_SIZE}
                  animationBegin={MODAL_SURFACE_TRANSITION_MS}
                />
              )) : (
                <Bar
                  dataKey="utilizationPct"
                  shape={(props) => (
                    <SingleCategoryBar
                      {...props}
                      stripePatternId={currentPeriodStripePatternIds.get(BUDGET_CHART_ACCENT_COLOR)}
                      axisMax={axisMax}
                      isOverBudget={overBudgetPeriodKeys.has(
                        (props.payload as BudgetChartPoint | undefined)?.periodKey ?? '',
                      )}
                    />
                  )}
                  barSize={BUDGET_BAR_SIZE}
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
