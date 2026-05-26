import {
  AnimatePresence,
  motion,
} from 'motion/react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import IconTooltip from '@/components/IconTooltip'
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
  displayCurrency,
  chartAnimationKey,
  prefersReducedMotion,
  className = '',
}: {
  categorySpend: OverviewCategorySpend[]
  displayCurrency: string
  chartAnimationKey: string
  prefersReducedMotion: boolean | null
  className?: string
}) {
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
  const chartAnimationDuration = prefersReducedMotion ? 0 : 550
  const contentTransition = { duration: prefersReducedMotion ? 0 : 0.24, ease: [0.25, 0.1, 0.25, 1] } as const

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
              key="category-chart"
              layout
              style={{ height: topCategoryChartHeight }}
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
                  <Tooltip
                    wrapperClassName="app-chart-tooltip-compact"
                    cursor={{ fill: 'var(--app-surface-soft)' }}
                    formatter={(value) => [formatCurrency(Number(value), displayCurrency), 'Spent']}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
