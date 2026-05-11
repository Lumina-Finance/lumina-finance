import { useMemo, useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAccountSnapshots, type Account } from '@/api/accounts'
import { TimeRangeSelector, type TimeRangeSelectorOption } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RANGE_CONFIG,
  type BalanceRange,
} from '@/accounts/detail/constants/accountDetail'
import { buildChartSeries, rezeroSeriesToPeriod } from '@/accounts/detail/utils/balanceChartSeries'
import { toISODate } from '@/accounts/detail/utils/date'

const BALANCE_RANGE_OPTIONS: TimeRangeSelectorOption<BalanceRange>[] = [
  { value: '7D', label: '7D', description: 'Last 7 days' },
  { value: '30D', label: '30D', description: 'Last 30 days' },
  { value: '90D', label: '90D', description: 'Last 90 days' },
  { value: '1Y', label: '1Y', description: 'Last year' },
]

export default function BalanceChartCard({ account }: { account: Account }) {
  const [range, setRange] = useState<BalanceRange>('30D')

  // Derive the snapshot query window from the selected range.
  const { fromDate, granularity } = useMemo(() => {
    const cfg = RANGE_CONFIG[range]
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = new Date(today)
    from.setDate(from.getDate() - (cfg.days - 1))
    return { fromDate: from, granularity: cfg.granularity }
  }, [range])

  const { data: snapshots } = useAccountSnapshots(account.id, {
    fromDate: toISODate(fromDate),
    granularity,
    includeAnchor: true,
  })

  const series = useMemo(
    () => buildChartSeries(snapshots ?? [], fromDate, granularity),
    [snapshots, fromDate, granularity],
  )
  const chartSeries = useMemo(() => rezeroSeriesToPeriod(series), [series])

  // First point in a new year, used for the dashed year-boundary marker.
  let yearBoundary: { dateKey: string; year: string } | null = null
  for (let i = 1; i < series.length; i++) {
    if (series[i].date.slice(0, 4) !== series[i - 1].date.slice(0, 4)) {
      yearBoundary = { dateKey: series[i].date, year: series[i].date.slice(0, 4) }
      break
    }
  }

  // First-to-last delta for the selected window.
  const periodDelta = useMemo(() => {
    if (series.length < 2) return null
    const start = series[0].balance
    const end = series[series.length - 1].balance
    const absolute = end - start
    const pct = start === 0 ? null : (absolute / Math.abs(start)) * 100
    return { absolute, pct }
  }, [series])

  const trendUp = periodDelta !== null && periodDelta.absolute >= 0
  const lineColor = account.current_balance < 0 ? 'var(--app-negative)' : 'var(--app-accent)'
  const deltaColor = periodDelta === null
    ? 'var(--app-text-muted)'
    : trendUp
      ? 'var(--app-positive)'
      : 'var(--app-negative)'

  return (
    <section
      className="app-card flex flex-col"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">Current Balance</p>
        <TimeRangeSelector
          value={range}
          options={BALANCE_RANGE_OPTIONS}
          onChange={setRange}
          ariaLabel="Balance range"
          className="hidden min-[750px]:inline-flex"
        />
        <TimeRangeSelector
          value={range}
          options={BALANCE_RANGE_OPTIONS}
          onChange={setRange}
          ariaLabel="Balance range"
          variant="mobile"
          className="w-full min-[750px]:hidden"
          sheetTitle="Balance range"
        />
      </div>

      <div className="mb-4">
        <p
          className="font-financial font-normal leading-none text-3xl"
          style={{ color: account.current_balance < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
        >
          {formatCurrency(account.current_balance, account.currency)}
        </p>
        {periodDelta !== null && (
          <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: deltaColor }}>
            {trendUp ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
            <span>
              {trendUp ? '+' : '−'}
              {formatCurrency(Math.abs(periodDelta.absolute), account.currency)}
              {periodDelta.pct !== null && (
                <>
                  {' '}
                  ({trendUp ? '+' : '−'}
                  {Math.abs(periodDelta.pct).toFixed(1)}%)
                </>
              )}
            </span>
            <span style={{ color: 'var(--app-text-subtle)' }}>· {range.toLowerCase()}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[240px] w-full">
        {series.length < 2 ? (
          <div
            className="h-full w-full rounded-lg flex items-center justify-center text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            Not enough history yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartSeries} margin={{ top: 18, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={`balanceFill-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickMargin={4}
                tickFormatter={(value: string) =>
                  series.find((s) => s.date === value)?.dateLabel ?? value
                }
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
                labelFormatter={(value) =>
                  series.find((s) => s.date === value)?.tooltipLabel ?? String(value)
                }
                formatter={(value) => [formatCurrency(Number(value), account.currency), 'Change']}
              />
              <ReferenceLine
                y={0}
                stroke="var(--app-text-subtle)"
                strokeDasharray="4 3"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
              <Area
                type="monotone"
                dataKey="periodBalance"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#balanceFill-${account.id})`}
              />
              {yearBoundary && (
                <ReferenceLine
                  x={yearBoundary.dateKey}
                  stroke="var(--app-text-muted)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  label={{
                    value: yearBoundary.year,
                    position: 'top',
                    fill: 'var(--app-text-muted)',
                    fontSize: 11,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
