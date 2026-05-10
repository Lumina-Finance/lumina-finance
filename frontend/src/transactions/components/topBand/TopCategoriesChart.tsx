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
} from '@/transactions/components/topBand/constants'
import type { OverviewCategorySpend } from '@/transactions/components/topBand/types'

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
  const topCategoryChartHeight = Math.max(24, categorySpend.length * 26)
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
          The top 5 categories as ranked by total amount spent in the selected period. The progress bar is relative to the highest-spend category, not an absolute scale.
        </IconTooltip>
      </p>
      <div className="mt-2">
        <div style={{ height: topCategoryChartHeight }}>
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
                tick={{ fontSize: 13, fill: 'var(--app-text-subtle)' }}
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
        </div>
      </div>
    </div>
  )
}
