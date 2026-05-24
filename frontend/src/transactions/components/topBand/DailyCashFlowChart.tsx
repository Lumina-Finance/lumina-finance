import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyCashFlow } from '@/api/transactions'
import { formatCurrency } from '@/utils/formatCurrency'
import { PLACEHOLDER_DAILY_FLOW } from '@/transactions/components/topBand/constants'
import { parseYmdLocal } from '@/transactions/utils/date'

function getDailyCashFlowSeries(
  raw: DailyCashFlow[],
): { date: string; inflow: number; outflow: number }[] {
  if (raw.length === 0) return []

  // The API only returns days with activity; pad missing days so the line chart has a continuous axis.
  const byDate = new Map(raw.map((day) => [day.date, day]))
  const first = parseYmdLocal(raw[0].date)
  const last = parseYmdLocal(raw[raw.length - 1].date)
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1)
  const result: { date: string; inflow: number; outflow: number }[] = []

  while (cursor <= last) {
    const iso = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, '0'),
      String(cursor.getDate()).padStart(2, '0'),
    ].join('-')
    const entry = byDate.get(iso)
    result.push({
      date: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      inflow: entry?.inflow ?? 0,
      outflow: entry?.outflow ?? 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

export default function DailyCashFlowChart({
  rawDailyFlow,
  hasOverviewData,
  displayCurrency,
  chartAnimationKey,
  prefersReducedMotion,
}: {
  rawDailyFlow: DailyCashFlow[]
  hasOverviewData: boolean
  displayCurrency: string
  chartAnimationKey: string
  prefersReducedMotion: boolean | null
}) {
  const dailyFlow = hasOverviewData ? getDailyCashFlowSeries(rawDailyFlow) : PLACEHOLDER_DAILY_FLOW
  const chartAnimationDuration = prefersReducedMotion ? 0 : 550

  return (
    <>
      <p className="app-label mb-3">Daily Cash Flow</p>
      <div className="h-[11.75rem]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            key={`daily-flow-${chartAnimationKey}`}
            data={dailyFlow}
            margin={{ top: 4, right: 12, bottom: 0, left: 12 }}
          >
            <defs>
              <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-positive)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--app-positive)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="outflowGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="var(--app-negative)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--app-negative)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'var(--app-text-subtle)' }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.ceil(dailyFlow.length / 10) - 1)}
            />
            <YAxis hide />
            <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
            <Tooltip
              wrapperClassName="app-chart-tooltip-compact"
              formatter={(value, name) => [
                formatCurrency(Math.abs(Number(value)), displayCurrency),
                name === 'inflow' ? 'Inflow' : 'Outflow',
              ]}
            />
            <Area
              type="monotone"
              dataKey="inflow"
              stroke="var(--app-positive)"
              fill="url(#inflowGrad)"
              strokeWidth={1.5}
              isAnimationActive={!prefersReducedMotion}
              animationDuration={chartAnimationDuration}
            />
            <Area
              type="monotone"
              dataKey="outflow"
              stroke="var(--app-negative)"
              fill="url(#outflowGrad)"
              strokeWidth={1.5}
              isAnimationActive={!prefersReducedMotion}
              animationDuration={chartAnimationDuration}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
