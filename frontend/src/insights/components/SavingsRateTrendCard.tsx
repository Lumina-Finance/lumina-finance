import { useMemo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SavingsCurrentBoundary } from '@/dashboard/components/SavingsCurrentBoundary'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'

export type SavingsRateHistoryPoint = {
  monthKey: string
  monthLabel: string
  tickLabel: string
  fullLabel: string
  rate: number | null
  income: number
  expenses: number
  isCurrent: boolean
}

type SavingsRateYAxisTickProps = {
  x?: number
  y?: number
  payload?: {
    value?: number | string
  }
  maximum: number
}

type SavingsRateTrendCardProps = {
  header: ReactNode
  series: SavingsRateHistoryPoint[]
  displayCurrency: string
  capRates: boolean
  emptyLabel?: string
  loading?: boolean
  transitionKey: string
}

type SavingsRateTrendSnapshot = {
  series: SavingsRateHistoryPoint[]
  displayCurrency: string
  capRates: boolean
  emptyLabel: string
}

function getSavingsTier(rate: number | null) {
  if (rate === null) return 'negative'
  if (rate >= 20) return 'positive'
  if (rate > 0) return 'accent'
  return 'negative'
}

function getSavingsTierColor(tier: ReturnType<typeof getSavingsTier>) {
  if (tier === 'positive') return 'var(--app-chart-positive)'
  if (tier === 'negative') return 'var(--app-chart-negative)'
  return 'var(--app-accent)'
}

function formatSavingsRateValue(rate: number | null) {
  return rate === null ? 'N/A' : `${rate}%`
}

function clampSavingsRate(rate: number | null) {
  if (rate === null) return null
  return Math.max(-100, Math.min(100, rate))
}

function SavingsRateHistoryTooltip({
  active,
  payload,
  displayCurrency,
}: {
  active?: boolean
  payload?: Array<{ payload?: SavingsRateHistoryPoint }>
  displayCurrency: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="app-chart-tooltip-default-content min-w-48">
      <p className="app-tooltip-muted">{point.fullLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span>Savings Rate</span>
        <span className="font-financial">{formatSavingsRateValue(point.rate)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Income</span>
        <span className="font-financial">{formatCurrency(point.income, displayCurrency)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Expenses</span>
        <span className="font-financial">{formatCurrency(point.expenses, displayCurrency)}</span>
      </div>
    </div>
  )
}

function SavingsRateYAxisTick({
  x = 0,
  y = 0,
  payload,
  maximum,
}: SavingsRateYAxisTickProps) {
  const value = Number(payload?.value)
  const isMaximum = value === maximum

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={isMaximum ? 13 : 11}
      fontWeight={isMaximum ? 700 : 500}
      fill={isMaximum ? 'var(--app-text)' : 'var(--app-text-subtle)'}
    >
      {Number.isFinite(value) ? `${value}%` : ''}
    </text>
  )
}

export function SavingsRateTrendCard({
  header,
  series,
  displayCurrency,
  capRates,
  emptyLabel = 'No savings-rate history available',
  loading = false,
  transitionKey,
}: SavingsRateTrendCardProps) {
  const incomingSnapshot = useMemo<SavingsRateTrendSnapshot>(() => ({
    series,
    displayCurrency,
    capRates,
    emptyLabel,
  }), [capRates, displayCurrency, emptyLabel, series])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useInsightLoadingSnapshot<SavingsRateTrendSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const hasActivity = displaySnapshot.series.some((point) => point.income > 0 || point.expenses > 0)
  const currentPoint = displaySnapshot.series.find((point) => point.isCurrent)
  const tickLabels = new Map(displaySnapshot.series.map((point) => [point.monthKey, point.tickLabel]))
  const ratedPoints = displaySnapshot.series.filter((point) => point.rate !== null)
  const averageRate = ratedPoints.length > 0
    ? Math.round(ratedPoints.reduce((sum, point) => sum + (point.rate ?? 0), 0) / ratedPoints.length)
    : null
  const latestPoint = displaySnapshot.series.at(-1)
  const bestPoint = ratedPoints.reduce<SavingsRateHistoryPoint | null>(
    (best, point) => (best === null || (point.rate ?? -Infinity) > (best.rate ?? -Infinity) ? point : best),
    null,
  )
  const worstPoint = ratedPoints.reduce<SavingsRateHistoryPoint | null>(
    (worst, point) => (worst === null || (point.rate ?? Infinity) < (worst.rate ?? Infinity) ? point : worst),
    null,
  )
  const chartSeries = displaySnapshot.series.map((point) => ({
    ...point,
    chartRate: displaySnapshot.capRates ? clampSavingsRate(point.rate) : point.rate,
  }))
  const chartRates = chartSeries
    .map((point) => point.chartRate)
    .filter((rate): rate is number => rate !== null)
  const averageChartRate = displaySnapshot.capRates ? clampSavingsRate(averageRate) : averageRate
  const highestRate = chartRates.length > 0 ? Math.max(...chartRates) : 100
  const lowestRate = chartRates.length > 0 ? Math.min(...chartRates) : -100
  const hasPositiveRate = chartRates.some((rate) => rate > 0)
  const hasNegativeRate = chartRates.some((rate) => rate < 0)
  const hasFullRate = chartRates.some((rate) => rate >= 100)
  const showCappedPositiveSection = displaySnapshot.capRates && (hasPositiveRate || !hasNegativeRate)
  const showCappedNegativeSection = displaySnapshot.capRates && hasNegativeRate
  const yAxisDomain = displaySnapshot.capRates
    ? [showCappedNegativeSection ? -100 : 0, showCappedPositiveSection ? 100 : 0]
    : [hasNegativeRate ? Math.min(-100, lowestRate) : 0, Math.max(highestRate, 0)]
  const yAxisTicks = Array.from(new Set(displaySnapshot.capRates ? [
    ...(showCappedNegativeSection ? [-100] : []),
    0,
    ...(showCappedPositiveSection ? [100] : []),
  ] : [
    ...(hasNegativeRate ? [-100] : []),
    lowestRate,
    ...(averageChartRate !== null ? [averageChartRate] : []),
    0,
    ...(hasFullRate ? [100] : []),
  ]))
    .filter((tick) => tick >= yAxisDomain[0] && tick <= yAxisDomain[1])
    .sort((a, b) => a - b)

  return (
    <section className="app-card">
      {header}
      <div className="relative overflow-hidden">
        <InsightLoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="flex flex-col min-[750px]:h-[430px]">
            <div className="mb-4 grid gap-4 border-b border-[var(--app-border)] pb-4 min-[750px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)] min-[750px]:items-center min-[750px]:gap-6">
              <div className="min-w-0">
                <p className="app-label">Latest Savings Rate</p>
                <p className="mt-1 font-financial text-4xl leading-none tracking-tight">
                  {formatSavingsRateValue(latestPoint?.rate ?? null)}
                </p>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
                  {latestPoint?.fullLabel ?? 'No recent month'}
                </p>
              </div>
              <div className="grid min-w-0 gap-2 min-[550px]:grid-cols-3 min-[750px]:gap-4">
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className="app-label app-label-compact">Average</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(averageRate)}
                    </p>
                    <p className="truncate text-right text-xs min-[750px]:mt-2 min-[750px]:text-left min-[750px]:text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      Last 12 months
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className="app-label app-label-compact">Best</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(bestPoint?.rate ?? null)}
                    </p>
                    <p className="truncate text-right text-xs min-[750px]:mt-2 min-[750px]:text-left min-[750px]:text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {bestPoint?.fullLabel ?? 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className="app-label app-label-compact">Worst</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(worstPoint?.rate ?? null)}
                    </p>
                    <p className="truncate text-right text-xs min-[750px]:mt-2 min-[750px]:text-left min-[750px]:text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {worstPoint?.fullLabel ?? 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-[300px] shrink-0 min-[750px]:h-auto min-[750px]:min-h-0 min-[750px]:flex-1 min-[750px]:shrink">
              {!hasActivity ? (
                <div
                  className="flex h-full w-full items-center justify-center text-sm"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
                  {displaySnapshot.emptyLabel}
                </div>
              ) : (
                <div className="relative h-full">
              <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
                <defs>
                  {(['positive', 'accent', 'negative'] as const).map((tier) => (
                    <pattern
                      key={tier}
                      id={`insights-savings-stripes-${tier}`}
                      patternUnits="userSpaceOnUse"
                      width={6}
                      height={6}
                      patternTransform="rotate(45)"
                    >
                      <rect
                        width={3}
                        height={6}
                        style={{ fill: getSavingsTierColor(tier) }}
                      />
                    </pattern>
                  ))}
                </defs>
              </svg>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartSeries} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                  <XAxis
                    dataKey="monthKey"
                    axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                    tickFormatter={(value) => tickLabels.get(String(value)) ?? String(value)}
                    tickMargin={4}
                  />
                  <YAxis
                    width={52}
                    axisLine={false}
                    tickLine={false}
                    domain={yAxisDomain}
                    ticks={yAxisTicks}
                    tick={<SavingsRateYAxisTick maximum={Number.NaN} />}
                  />
                  <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
                  {averageChartRate !== null && (
                    <ReferenceLine
                      y={averageChartRate}
                      stroke="var(--app-accent)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.72}
                      strokeWidth={1}
                    />
                  )}
                  {currentPoint && <SavingsCurrentBoundary currentLabel={currentPoint.monthKey} />}
                  <Tooltip
                    wrapperClassName="app-chart-tooltip-default"
                    cursor={{ fill: 'var(--app-border)', opacity: 0.4 }}
                    content={<SavingsRateHistoryTooltip displayCurrency={displaySnapshot.displayCurrency} />}
                  />
                  <Bar dataKey="chartRate" radius={[3, 3, 0, 0]} maxBarSize={30}>
                    {chartSeries.map((entry) => {
                      const tier = getSavingsTier(entry.rate)
                      return (
                        <Cell
                          key={entry.monthKey}
                          fill={
                            entry.isCurrent
                              ? `url(#insights-savings-stripes-${tier})`
                              : getSavingsTierColor(tier)
                          }
                        />
                      )
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
          <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
            <span>Latest 12 months, up to available data.</span>
            {' '}
            <AnimatePresence initial={false}>
              {displaySnapshot.capRates && (
                <motion.span
                  className="inline-block font-semibold"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  Chart scale is capped at 100%.
                </motion.span>
              )}
            </AnimatePresence>
          </p>
          <div className="flex w-full items-center justify-center gap-4 text-xs min-[750px]:w-auto" style={{ color: 'var(--app-text-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-chart-positive)' }} />
              20%+
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-accent)' }} />
              1-19%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-chart-negative)' }} />
              0% or less
            </span>
          </div>
        </div>
          </div>
        </InsightLoadingContent>

        <InsightLoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading savings rate trend"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
