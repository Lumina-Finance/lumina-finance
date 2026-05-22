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
  BalanceChartModeSelector,
  type BalanceChartMode,
} from '@/accounts/detail/components/BalanceChartModeSelector'
import {
  RANGE_CONFIG,
  type BalanceRange,
} from '@/accounts/detail/constants/accountDetail'
import {
  calendarDateMs,
  formatSignedBalanceCurrency,
  formatUtcAxisDate,
  getBalanceXAxisTicks,
} from '@/accounts/detail/utils/balanceChartAxis'
import {
  buildChartSeries,
  rezeroSeriesToPeriod,
  type BalanceChartPoint,
} from '@/accounts/detail/utils/balanceChartSeries'
import { toISODate } from '@/accounts/detail/utils/date'

const BALANCE_RANGE_OPTIONS: TimeRangeSelectorOption<BalanceRange>[] = [
  { value: '7D', label: '7D', description: 'Last 7 days' },
  { value: '30D', label: '30D', description: 'Last 30 days' },
  { value: '90D', label: '90D', description: 'Last 90 days' },
  { value: '1Y', label: '1Y', description: 'Last year' },
]
const BALANCE_AXIS_EDGE_PADDING_PX = 4

type AxisTickProps = {
  x?: number | string
  y?: number | string
  payload?: {
    value: number | string
  }
}

function BalanceXAxisTick({
  x = 0,
  y = 0,
  payload,
  axisStartMs,
  axisEndMs,
  seriesByDateMs,
}: AxisTickProps & {
  axisStartMs: number
  axisEndMs: number
  seriesByDateMs: Map<number, BalanceChartPoint>
}) {
  const value = Number(payload?.value)
  const textAnchor = value === axisStartMs ? 'start' : value === axisEndMs ? 'end' : 'middle'
  const tickX = Number(x)
  const tickY = Number(y)

  return (
    <text
      x={tickX}
      y={tickY}
      dy={12}
      textAnchor={textAnchor}
      fill="var(--app-text-subtle)"
      fontSize={11}
    >
      {seriesByDateMs.get(value)?.dateLabel ?? formatUtcAxisDate(value)}
    </text>
  )
}

export default function BalanceChartCard({ account }: { account: Account }) {
  const [range, setRange] = useState<BalanceRange>('30D')
  const [chartMode, setChartMode] = useState<BalanceChartMode>('balance')

  // Derive the snapshot query window from the selected range.
  const { fromDate, toDate, granularity } = useMemo(() => {
    const cfg = RANGE_CONFIG[range]
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = new Date(today)
    from.setDate(from.getDate() - (cfg.days - 1))
    return { fromDate: from, toDate: today, granularity: cfg.granularity }
  }, [range])

  const { data: snapshots } = useAccountSnapshots(account.id, {
    fromDate: toISODate(fromDate),
    toDate: toISODate(toDate),
    granularity: 'day',
    includeAnchor: true,
  })

  const series = useMemo(
    () => buildChartSeries(snapshots ?? [], fromDate, toDate, granularity),
    [snapshots, fromDate, toDate, granularity],
  )
  const periodSeries = useMemo(() => rezeroSeriesToPeriod(series), [series])
  const chartSeries = chartMode === 'balance' ? series : periodSeries
  const chartDataKey = chartMode === 'balance' ? 'balance' : 'periodBalance'
  const axisStartMs = calendarDateMs(fromDate)
  const axisEndMs = calendarDateMs(toDate)
  const xAxisTicks = useMemo(
    () => getBalanceXAxisTicks(fromDate, toDate, range),
    [fromDate, toDate, range],
  )
  const seriesByDateMs = useMemo(
    () => new Map(series.map((point) => [point.dateMs, point])),
    [series],
  )

  // First point in a new year, used for the dashed year-boundary marker.
  const yearStart = new Date(toDate.getFullYear(), 0, 1)
  const yearBoundary = fromDate < yearStart && yearStart <= toDate
    ? { dateMs: calendarDateMs(yearStart), year: String(toDate.getFullYear()) }
    : null

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
  const chartLineColor = chartMode === 'change' && periodDelta !== null ? deltaColor : lineColor

  return (
    <section
      className="app-card flex flex-col"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="app-label">Current Balance</p>
        <BalanceChartModeSelector
          value={chartMode}
          onChange={setChartMode}
          className="w-[9.5rem] shrink-0 min-[750px]:hidden"
        />
        <div className="ml-auto hidden items-center gap-2 min-[750px]:flex">
          <BalanceChartModeSelector value={chartMode} onChange={setChartMode} className="w-[9.5rem]" />
          <TimeRangeSelector
            value={range}
            options={BALANCE_RANGE_OPTIONS}
            onChange={setRange}
            ariaLabel="Balance range"
          />
        </div>
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
            <AreaChart
              data={chartSeries}
              margin={{
                top: 18,
                right: BALANCE_AXIS_EDGE_PADDING_PX,
                bottom: 0,
                left: BALANCE_AXIS_EDGE_PADDING_PX,
              }}
            >
              <defs>
                <linearGradient id={`balanceFill-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartLineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={chartLineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="dateMs"
                type="number"
                scale="time"
                domain={[axisStartMs, axisEndMs]}
                ticks={xAxisTicks}
                interval={0}
                axisLine={false}
                tickLine={false}
                tick={(props) => (
                  <BalanceXAxisTick
                    {...props}
                    axisStartMs={axisStartMs}
                    axisEndMs={axisEndMs}
                    seriesByDateMs={seriesByDateMs}
                  />
                )}
                tickMargin={4}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
                labelFormatter={(value) =>
                  seriesByDateMs.get(Number(value))?.tooltipLabel ?? String(value)
                }
                formatter={(value) => [
                  chartMode === 'balance'
                    ? formatCurrency(Number(value), account.currency)
                    : formatSignedBalanceCurrency(Number(value), account.currency),
                  chartMode === 'balance' ? 'Balance' : 'Change',
                ]}
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
                dataKey={chartDataKey}
                stroke={chartLineColor}
                strokeWidth={2}
                fill={`url(#balanceFill-${account.id})`}
              />
              {yearBoundary && (
                <ReferenceLine
                  x={yearBoundary.dateMs}
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
