import {
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  AnimatePresence,
  motion,
} from 'motion/react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { FxStatus } from '@/api/shared/fx'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredTooltipOverlay'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/TooltipContent'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import {
  getChartDataSignature,
  useChartEntranceAnimation,
} from '@/components/charts/useChartEntranceAnimation'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { formatCurrency } from '@/utils/formatCurrency'
import { useDeferredMount } from '@/hooks/useDeferredMount'
import {
  TOP_CATEGORY_AXIS_AVG_CHAR_WIDTH,
  TOP_CATEGORY_AXIS_LABEL_PADDING,
  TOP_CATEGORY_AXIS_MIN_WIDTH,
  TOP_CATEGORY_LIMIT,
  TOP_CATEGORY_ROW_HEIGHT,
} from '@/pages/transactions/components/top-band/constants'
import type { OverviewCategorySpend } from '@/pages/transactions/components/top-band/types'
import { getTopCategoriesFxStatusMessage } from '@/pages/transactions/utils/fxTooltipMessages'

const emptyTopCategoryHeight = TOP_CATEGORY_LIMIT * TOP_CATEGORY_ROW_HEIGHT

// Overrides Bar's own 400 ms default, holding the entrance this chart ran before its animation
// state moved to the shared hook
const TOP_CATEGORY_BAR_ENTRANCE_DURATION_MS = 550

function getTopCategoryTooltipKey(point: OverviewCategorySpend) {
  return point.name
}

/**
 * Renders top-category spend values with shared chart tooltip typography
 */
function TopCategoryTooltipContent({
  point,
  displayCurrency,
}: {
  point: OverviewCategorySpend
  displayCurrency: string
}) {
  return (
    <>
      <ChartTooltipTitle>{point.name}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Spent"
        value={formatCurrency(point.amount, displayCurrency)}
        financialValue
      />
    </>
  )
}

/**
 * Renders category labels through a custom tick so Recharts does not apply its default SVG text styling
 */
function TopCategoryYAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number
  y?: number
  payload?: { value?: string | number }
}) {
  return (
    <text
      x={x}
      y={y}
      dominantBaseline="central"
      fill="var(--app-text-subtle)"
      fontSize={13}
      textAnchor="end"
    >
      {payload?.value ?? ''}
    </text>
  )
}

/**
 * Renders the transaction overview top-category spend chart
 */
export default function TopCategoriesChart({
  categorySpend,
  fxStatus,
  displayCurrency,
  chartAnimationKey,
  prefersReducedMotion,
  className = '',
}: {
  categorySpend: OverviewCategorySpend[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  chartAnimationKey: string
  prefersReducedMotion: boolean | null
  className?: string
}) {
  const topCategoryChartRef = useRef<HTMLDivElement>(null)
  const topCategoryTooltipRef = useRef<DeferredChartTooltipOverlayHandle<OverviewCategorySpend>>(null)
  const topCategoryChartHeight = Math.max(24, categorySpend.length * TOP_CATEGORY_ROW_HEIGHT)
  // The motion wrapper keeps the reserved height so deferring the recharts mount shifts nothing
  const chartReady = useDeferredMount()

  // Recharts needs an explicit Y-axis width because otherwise long category labels can clip
  const topCategoryAxisWidth = Math.max(
    TOP_CATEGORY_AXIS_MIN_WIDTH,
    Math.ceil(
      categorySpend.reduce((longest, category) => Math.max(longest, category.name.length), 0)
      * TOP_CATEGORY_AXIS_AVG_CHAR_WIDTH
      + TOP_CATEGORY_AXIS_LABEL_PADDING,
    ),
  )
  const topCategoryPointsByName = useMemo(
    () => new Map(categorySpend.map((category) => [category.name, category])),
    [categorySpend],
  )

  // The plot is remounted on this key whenever the filters or the range change, and a fresh mount
  // has to arm the entrance even when the new filters happen to leave the same five categories
  const dataSignature = useMemo(
    () => `${chartAnimationKey}:${getChartDataSignature(
      categorySpend,
      (point) => `${point.name}|${point.amount}`,
    )}`,
    [categorySpend, chartAnimationKey],
  )
  const topCategoryBarEntrance = useChartEntranceAnimation({ dataSignature })
  const contentTransition = { duration: prefersReducedMotion ? 0 : 0.24, ease: [0.25, 0.1, 0.25, 1] } as const

  /**
   * Resolves the hovered Recharts bar and forwards it to the deferred tooltip overlay
   */
  function showTopCategoryTooltip(
    state: RechartsTooltipState<OverviewCategorySpend>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getRechartsTooltipPoint({
      state,
      data: categorySpend,
      resolveLabel: (label) => topCategoryPointsByName.get(label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

    if (!point) {
      topCategoryTooltipRef.current?.show(null, pointer)
      return
    }

    topCategoryTooltipRef.current?.show(point, pointer)
  }
  const hideTopCategoryTooltip = () => topCategoryTooltipRef.current?.hide()

  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <p className="app-label mb-1 inline-flex items-center gap-2">
        Top Categories
        <IconTooltip
          label="How top categories are calculated"
          level="info"
          placement="bottom"
          widthClassName="w-64"
        >
          The top 5 categories ranked by net expense-side total in the selected period. The progress bar is relative to the highest-spend category, not an absolute scale.
        </IconTooltip>
        <FxStatusBadge
          label="Top categories FX status"
          fxStatus={fxStatus}
          placement="bottom"
          getMessage={getTopCategoriesFxStatusMessage}
        />
      </p>
      <div className="mt-2">
        <AnimatePresence initial={false} mode="popLayout">
          {categorySpend.length === 0 ? (
            <motion.p
              key="empty-categories"
              layout
              className="flex items-center justify-center text-center text-sm italic"
              style={{
                height: emptyTopCategoryHeight,
                color: 'var(--app-text-subtle)',
              }}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={contentTransition}
            >
              No qualifying transactions found
            </motion.p>
          ) : (
            <motion.div
              ref={topCategoryChartRef}
              key="category-chart"
              layout
              className="relative"
              style={{ height: topCategoryChartHeight }}
              onMouseLeave={hideTopCategoryTooltip}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={contentTransition}
            >
              {chartReady && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  key={`categories-${chartAnimationKey}`}
                  data={categorySpend}
                  layout="vertical"
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  onMouseMove={(state, event) => showTopCategoryTooltip(state, event)}
                  onMouseLeave={hideTopCategoryTooltip}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={topCategoryAxisWidth}
                    interval={0}
                    tickMargin={6}
                    tick={<TopCategoryYAxisTick />}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar
                    dataKey="amount"
                    radius={[0, 5, 5, 0]}
                    barSize={16}
                    animationDuration={TOP_CATEGORY_BAR_ENTRANCE_DURATION_MS}
                    {...topCategoryBarEntrance}
                  >
                    {categorySpend.map((_, index) => (
                      <Cell
                        key={index}
                        fill={index === 0 ? 'var(--app-accent)' : 'var(--app-border-strong)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              )}
              <DeferredChartTooltipOverlay
                ref={topCategoryTooltipRef}
                chartRef={topCategoryChartRef}
                className="min-w-40"
                showGuide={false}
                getKey={getTopCategoryTooltipKey}
                renderContent={(point) => (
                  <TopCategoryTooltipContent
                    point={point}
                    displayCurrency={displayCurrency}
                  />
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
