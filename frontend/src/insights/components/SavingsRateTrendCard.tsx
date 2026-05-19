import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
}

const savingsRateHistoryLimit = 12

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
}: SavingsRateTrendCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const hasActivity = series.some((point) => point.income > 0 || point.expenses > 0)
  const currentPoint = series.find((point) => point.isCurrent)
  const tickLabels = new Map(series.map((point) => [point.monthKey, point.tickLabel]))
  const ratedPoints = series.filter((point) => point.rate !== null)
  const averageRate = ratedPoints.length > 0
    ? Math.round(ratedPoints.reduce((sum, point) => sum + (point.rate ?? 0), 0) / ratedPoints.length)
    : null
  const latestPoint = series.at(-1)
  const bestPoint = ratedPoints.reduce<SavingsRateHistoryPoint | null>(
    (best, point) => (best === null || (point.rate ?? -Infinity) > (best.rate ?? -Infinity) ? point : best),
    null,
  )
  const worstPoint = ratedPoints.reduce<SavingsRateHistoryPoint | null>(
    (worst, point) => (worst === null || (point.rate ?? Infinity) < (worst.rate ?? Infinity) ? point : worst),
    null,
  )
  const windowMonths = Math.min(savingsRateHistoryLimit, series.length)
  const firstPoint = series[0]
  const averagePeriodLabel = firstPoint && latestPoint
    ? firstPoint.fullLabel === latestPoint.fullLabel
      ? firstPoint.fullLabel
      : `${firstPoint.fullLabel} to ${latestPoint.fullLabel}`
    : 'No available history'
  const latestComparison = `${formatSavingsRateValue(latestPoint?.rate ?? null)} vs ${formatSavingsRateValue(averageRate)}`
  const chartSeries = series.map((point) => ({
    ...point,
    chartRate: capRates ? clampSavingsRate(point.rate) : point.rate,
  }))
  const chartRates = chartSeries
    .map((point) => point.chartRate)
    .filter((rate): rate is number => rate !== null)
  const averageChartRate = capRates ? clampSavingsRate(averageRate) : averageRate
  const highestRate = chartRates.length > 0 ? Math.max(...chartRates) : 100
  const lowestRate = chartRates.length > 0 ? Math.min(...chartRates) : -100
  const hasPositiveRate = chartRates.some((rate) => rate > 0)
  const hasNegativeRate = chartRates.some((rate) => rate < 0)
  const hasFullRate = chartRates.some((rate) => rate >= 100)
  const showCappedPositiveSection = capRates && (hasPositiveRate || !hasNegativeRate)
  const showCappedNegativeSection = capRates && hasNegativeRate
  const yAxisDomain = capRates
    ? [showCappedNegativeSection ? -100 : 0, showCappedPositiveSection ? 100 : 0]
    : [hasNegativeRate ? Math.min(-100, lowestRate) : 0, Math.max(highestRate, 0)]
  const yAxisTicks = Array.from(new Set([
    ...((capRates ? showCappedNegativeSection : hasNegativeRate) ? [-100] : []),
    ...(capRates ? [0] : []),
    lowestRate,
    ...(averageChartRate !== null ? [averageChartRate] : []),
    highestRate,
    ...((capRates ? showCappedPositiveSection : hasFullRate) ? [100] : []),
  ]))
    .filter((tick) => tick >= yAxisDomain[0] && tick <= yAxisDomain[1])
    .sort((a, b) => a - b)

  return (
    <section className="app-card">
      {header}
      <div className="flex h-[430px] flex-col">
        <div className="mb-4 grid gap-4 border-b border-[var(--app-border)] pb-4 min-[760px]:grid-cols-3">
          <div className="pl-4">
            <p className="app-label">{windowMonths}-Month Average</p>
            <p className="mt-1 font-financial text-3xl leading-none tracking-tight">
              {formatSavingsRateValue(averageRate)}
            </p>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
              {averagePeriodLabel}
            </p>
          </div>
          <div>
            <p className="app-label">Latest vs Average</p>
            <p className="mt-1 font-financial text-3xl leading-none tracking-tight">
              {latestComparison}
            </p>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
              {latestPoint?.fullLabel ?? 'No recent month'}
            </p>
          </div>
          <div>
            <p className="app-label">Best / Worst</p>
            <p className="mt-1 font-financial text-3xl leading-none tracking-tight">
              {formatSavingsRateValue(bestPoint?.rate ?? null)} / {formatSavingsRateValue(worstPoint?.rate ?? null)}
            </p>
            <p className="mt-2 truncate text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
              {bestPoint?.fullLabel ?? 'N/A'} high, {worstPoint?.fullLabel ?? 'N/A'} low
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {!hasActivity ? (
            <div
              className="flex h-full w-full items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              No savings-rate history in this range
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
                    tick={<SavingsRateYAxisTick maximum={highestRate} />}
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
                    content={<SavingsRateHistoryTooltip displayCurrency={displayCurrency} />}
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
              {capRates && (
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
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--app-text-muted)' }}>
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
    </section>
  )
}
