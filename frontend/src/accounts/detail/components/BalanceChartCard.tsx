import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { useAccountSnapshots, type Account } from '@/api/accounts'
import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/ChartTooltipContent'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import { TimeRangeSelector, type TimeRangeSelectorOption } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import {
  BalanceChartModeSelector,
} from '@/accounts/detail/components/BalanceChartModeSelector'
import {
  type BalanceChartMode,
  type BalanceRange,
} from '@/accounts/detail/constants/accountDetail'
import {
  formatSignedBalanceCurrency,
  formatUtcAxisDate,
} from '@/accounts/detail/utils/balanceChartAxis'
import {
  type BalanceChartPoint,
} from '@/accounts/detail/utils/balanceChartSeries'
import {
  getBalanceChartSnapshot,
  getBalanceRangeWindow,
  type BalanceChartDataPoint,
  type BalanceChartSnapshot,
} from '@/accounts/detail/utils/balanceChartViewModel'
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

function BalanceChartTooltipContent({
  point,
  chartMode,
  currency,
}: {
  point: BalanceChartDataPoint
  chartMode: BalanceChartMode
  currency: string
}) {
  const label = chartMode === 'balance' ? 'Balance' : 'Change'
  const value = chartMode === 'balance'
    ? formatCurrency(point.balance, currency)
    : formatSignedBalanceCurrency(point.periodBalance ?? 0, currency)

  return (
    <>
      <ChartTooltipTitle>{point.tooltipLabel}</ChartTooltipTitle>
      <ChartTooltipRow
        label={label}
        value={value}
        financialValue
      />
    </>
  )
}

export default function BalanceChartCard({ account }: { account: Account }) {
  const balanceChartRef = useRef<HTMLDivElement>(null)
  const balanceTooltipRef = useRef<DeferredChartTooltipOverlayHandle<BalanceChartDataPoint>>(null)
  const [range, setRange] = useState<BalanceRange>('30D')
  const [chartMode, setChartMode] = useState<BalanceChartMode>('balance')

  const { fromDate, toDate, granularity } = useMemo(
    () => getBalanceRangeWindow(range),
    [range],
  )

  const { data: snapshots, isFetching } = useAccountSnapshots(account.id, {
    fromDate: toISODate(fromDate),
    toDate: toISODate(toDate),
    granularity: 'day',
    includeAnchor: true,
  })

  const incomingSnapshot = useMemo<BalanceChartSnapshot>(() => ({
    ...getBalanceChartSnapshot({
      snapshots: snapshots ?? [],
      range,
      chartMode,
      currentBalance: account.current_balance,
      currency: account.currency,
      fromDate,
      toDate,
      granularity,
    }),
  }), [
    account.currency,
    account.current_balance,
    chartMode,
    fromDate,
    granularity,
    range,
    snapshots,
    toDate,
  ])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<BalanceChartSnapshot>({
    snapshot: incomingSnapshot,
    loading: isFetching,
    transitionKey: range,
  })
  const showBalanceTooltip = (
    state: RechartsTooltipState<BalanceChartDataPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getRechartsTooltipPoint({
      state,
      data: displaySnapshot.chartSeries,
      resolveLabel: (label) => {
        const activeDateMs = Number(label)
        return Number.isFinite(activeDateMs)
          ? displaySnapshot.chartSeries.find((entry) => entry.dateMs === activeDateMs)
          : undefined
      },
    })
    const pointer = getRechartsTooltipPointer(state, event)

    if (!point) {
      balanceTooltipRef.current?.show(null, pointer)
      return
    }

    balanceTooltipRef.current?.show(point, pointer)
  }
  const hideBalanceTooltip = () => balanceTooltipRef.current?.hide()

  useEffect(() => {
    balanceTooltipRef.current?.hide()
  }, [displaySnapshot.chartMode, displaySnapshot.range])

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

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <LoadingContent
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="mb-4">
            <p
              className="font-financial font-normal leading-none text-3xl"
              style={{ color: displaySnapshot.currentBalance < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
            >
              {formatCurrency(displaySnapshot.currentBalance, displaySnapshot.currency)}
            </p>
            {displaySnapshot.periodDelta !== null && (
              <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: displaySnapshot.deltaColor }}>
                {displaySnapshot.trendUp ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
                <span>
                  {displaySnapshot.trendUp ? '+' : '−'}
                  {formatCurrency(Math.abs(displaySnapshot.periodDelta.absolute), displaySnapshot.currency)}
                  {displaySnapshot.periodDelta.pct !== null && (
                    <>
                      {' '}
                      ({displaySnapshot.trendUp ? '+' : '−'}
                      {Math.abs(displaySnapshot.periodDelta.pct).toFixed(1)}%)
                    </>
                  )}
                </span>
                <span style={{ color: 'var(--app-text-subtle)' }}>· {displaySnapshot.range.toLowerCase()}</span>
              </div>
            )}
          </div>

          <div
            ref={balanceChartRef}
            className="relative flex-1 min-h-[240px] w-full"
            onMouseLeave={hideBalanceTooltip}
          >
            {displaySnapshot.chartSeries.length < 2 ? (
              <div
                className="h-full w-full rounded-lg flex items-center justify-center text-sm"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                Not enough history yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={displaySnapshot.chartSeries}
                  margin={{
                    top: 18,
                    right: BALANCE_AXIS_EDGE_PADDING_PX,
                    bottom: 0,
                    left: BALANCE_AXIS_EDGE_PADDING_PX,
                  }}
                  onMouseMove={(state, event) => showBalanceTooltip(state, event)}
                  onMouseLeave={hideBalanceTooltip}
                >
                  <defs>
                    <linearGradient id={`balanceFill-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={displaySnapshot.chartLineColor} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={displaySnapshot.chartLineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="dateMs"
                    type="number"
                    scale="time"
                    domain={[displaySnapshot.axisStartMs, displaySnapshot.axisEndMs]}
                    ticks={displaySnapshot.xAxisTicks}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                    tick={(props) => (
                      <BalanceXAxisTick
                        {...props}
                        axisStartMs={displaySnapshot.axisStartMs}
                        axisEndMs={displaySnapshot.axisEndMs}
                        seriesByDateMs={displaySnapshot.seriesByDateMs}
                      />
                    )}
                    tickMargin={4}
                  />
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <ReferenceLine
                    y={0}
                    stroke="var(--app-text-subtle)"
                    strokeDasharray="4 3"
                    strokeWidth={2}
                    ifOverflow="extendDomain"
                  />
                  <Area
                    type="monotone"
                    dataKey={displaySnapshot.chartDataKey}
                    stroke={displaySnapshot.chartLineColor}
                    strokeWidth={2}
                    fill={`url(#balanceFill-${account.id})`}
                  />
                  {displaySnapshot.yearBoundary && (
                    <ReferenceLine
                      x={displaySnapshot.yearBoundary.dateMs}
                      stroke="var(--app-text-muted)"
                      strokeDasharray="4 3"
                      strokeWidth={1}
                      label={{
                        value: displaySnapshot.yearBoundary.year,
                        position: 'top',
                        fill: 'var(--app-text-muted)',
                        fontSize: 11,
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
            {displaySnapshot.chartSeries.length >= 2 && (
              <DeferredChartTooltipOverlay
                ref={balanceTooltipRef}
                chartRef={balanceChartRef}
                className="min-w-44"
                getKey={(point) => `${displaySnapshot.chartMode}:${point.dateMs}`}
                renderContent={(point) => (
                  <BalanceChartTooltipContent
                    point={point}
                    chartMode={displaySnapshot.chartMode}
                    currency={displaySnapshot.currency}
                  />
                )}
              />
            )}
          </div>
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading current balance"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
