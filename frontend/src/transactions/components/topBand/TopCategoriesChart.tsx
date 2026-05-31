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
import type { FxStatus } from '@/api/dashboard'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  TOP_CATEGORY_AXIS_AVG_CHAR_WIDTH,
  TOP_CATEGORY_AXIS_LABEL_PADDING,
  TOP_CATEGORY_AXIS_MIN_WIDTH,
  TOP_CATEGORY_LIMIT,
  TOP_CATEGORY_ROW_HEIGHT,
} from '@/transactions/components/topBand/constants'
import type { OverviewCategorySpend } from '@/transactions/components/topBand/types'

const emptyTopCategoryHeight = TOP_CATEGORY_LIMIT * TOP_CATEGORY_ROW_HEIGHT

type TopCategoryTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: OverviewCategorySpend
  }>
}

function getTopCategoryTooltipKey(point: OverviewCategorySpend) {
  return point.name
}

function getTopCategoryTooltipPointer(
  state: TopCategoryTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

function getTopCategoryTooltipPoint(
  state: TopCategoryTooltipState,
  data: OverviewCategorySpend[],
  pointsByName: Map<string, OverviewCategorySpend>,
) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  const activeIndex = Number(state.activeTooltipIndex)
  if (Number.isInteger(activeIndex)) return data[activeIndex]

  return state.activeLabel === undefined
    ? undefined
    : pointsByName.get(String(state.activeLabel))
}

function TopCategoryTooltipContent({
  point,
  displayCurrency,
}: {
  point: OverviewCategorySpend
  displayCurrency: string
}) {
  return (
    <>
      <p className="app-chart-tooltip-default-title">{point.name}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Spent</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(point.amount, displayCurrency)}
        </span>
      </div>
    </>
  )
}

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
  // Recharts needs an explicit Y-axis width; estimate it from label length to avoid clipping.
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
  const chartAnimationDuration = prefersReducedMotion ? 0 : 550
  const contentTransition = { duration: prefersReducedMotion ? 0 : 0.24, ease: [0.25, 0.1, 0.25, 1] } as const
  const showTopCategoryTooltip = (
    state: TopCategoryTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getTopCategoryTooltipPoint(state, categorySpend, topCategoryPointsByName)
    const pointer = getTopCategoryTooltipPointer(state, event)

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
        {fxStatus && (
          <IconTooltip
            label="Top categories FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="bottom"
            widthClassName="w-64"
          >
            <span className="block">{getFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
      </p>
      <div className="mt-2">
        <AnimatePresence initial={false} mode="popLayout">
          {categorySpend.length === 0 ? (
            <motion.div
              key="empty-categories"
              layout
              className="flex items-center justify-center rounded-md border px-2.5 py-2 text-sm italic"
              style={{
                height: emptyTopCategoryHeight,
                background: 'var(--app-surface-soft)',
                borderColor: 'var(--app-border)',
                color: 'var(--app-text-subtle)',
              }}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={contentTransition}
            >
              No category spend
            </motion.div>
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
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={chartAnimationDuration}
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
