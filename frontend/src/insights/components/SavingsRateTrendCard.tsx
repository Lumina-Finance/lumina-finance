import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpToLine, Repeat } from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { SavingsCurrentBoundary } from '@/dashboard/components/SavingsCurrentBoundary'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/dashboard/constants/chart'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { InsightActionButton } from './InsightActionButton'
import { SectionHeader } from './SectionHeader'
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
  series: SavingsRateHistoryPoint[]
  displayCurrency: string
  capRates: boolean
  onCapRatesToggle: () => void
  loading?: boolean
  transitionKey: string
}

type SavingsRateTrendSnapshot = {
  series: SavingsRateHistoryPoint[]
  displayCurrency: string
  capRates: boolean
  emptyLabel: string
}

type SavingsRateTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
}

const savingsRateChartMargin = { top: 8, right: 8, bottom: 0, left: 4 } as const

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

function SavingsRateHistoryTooltipContent({
  point,
  displayCurrency,
}: {
  point: SavingsRateHistoryPoint
  displayCurrency: string
}) {
  return (
    <>
      <p className="app-chart-tooltip-default-title">{point.fullLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Savings Rate</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatSavingsRateValue(point.rate)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Income</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(point.income, displayCurrency)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Expenses</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(point.expenses, displayCurrency)}
        </span>
      </div>
    </>
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
  series,
  displayCurrency,
  capRates,
  onCapRatesToggle,
  loading = false,
  transitionKey,
}: SavingsRateTrendCardProps) {
  const savingsRateChartRef = useRef<HTMLDivElement>(null)
  const savingsRateTooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredSavingsRatePoint, setHoveredSavingsRatePoint] = useState<SavingsRateHistoryPoint | null>(null)
  const [savingsRateTooltipVisible, setSavingsRateTooltipVisible] = useState(false)
  const incomingSnapshot = useMemo<SavingsRateTrendSnapshot>(() => ({
    series,
    displayCurrency,
    capRates,
    emptyLabel: loading ? 'Loading savings-rate history...' : 'No savings-rate history available',
  }), [capRates, displayCurrency, loading, series])
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
  const completedRatedPoints = ratedPoints.filter((point) => !point.isCurrent)
  const averageRate = completedRatedPoints.length > 0
    ? Math.round(completedRatedPoints.reduce((sum, point) => sum + (point.rate ?? 0), 0) / completedRatedPoints.length)
    : null
  const latestPoint = displaySnapshot.series.at(-1)
  const bestPoint = completedRatedPoints.reduce<SavingsRateHistoryPoint | null>(
    (best, point) => (best === null || (point.rate ?? -Infinity) > (best.rate ?? -Infinity) ? point : best),
    null,
  )
  const worstPoint = completedRatedPoints.reduce<SavingsRateHistoryPoint | null>(
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
  const updateSavingsRateTooltipPosition = (event: ReactMouseEvent<Element>) => {
    const rect = savingsRateChartRef.current?.getBoundingClientRect()
    const tooltip = savingsRateTooltipRef.current
    if (!rect || !tooltip) return

    const tooltipX = Math.min(
      Math.max(event.clientX - rect.left, 0),
      Math.max(rect.width - tooltip.offsetWidth, 0),
    )
    const tooltipY = Math.min(
      Math.max(event.clientY - rect.top, 0),
      Math.max(rect.height - tooltip.offsetHeight, 0),
    )

    tooltip.style.setProperty('--savings-rate-tooltip-x', `${tooltipX}px`)
    tooltip.style.setProperty('--savings-rate-tooltip-y', `${tooltipY}px`)
  }
  const showSavingsRateTooltip = (
    state: SavingsRateTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    updateSavingsRateTooltipPosition(event)

    const activeIndex = Number(state.activeTooltipIndex)
    const point = Number.isInteger(activeIndex)
      ? displaySnapshot.series[activeIndex]
      : displaySnapshot.series.find((item) => item.monthKey === String(state.activeLabel))
    if (!point) {
      setSavingsRateTooltipVisible(false)
      return
    }

    setHoveredSavingsRatePoint((current) => (
      current?.monthKey === point.monthKey ? current : point
    ))
    setSavingsRateTooltipVisible(true)
  }
  const hideSavingsRateTooltip = () => {
    setSavingsRateTooltipVisible(false)
  }
  const handleSavingsRateTooltipTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || savingsRateTooltipVisible) return
    setHoveredSavingsRatePoint(null)
  }

  return (
    <section className="app-card">
      <SectionHeader
        icon={Repeat}
        label="Savings Rate Trend"
        action={(
          <InsightActionButton
            title={capRates ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
            ariaLabel={capRates ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
            onPress={onCapRatesToggle}
          >
            <ArrowUpToLine
              size={12}
              className={`transition-transform duration-150 motion-reduce:transition-none ${capRates ? 'rotate-180' : ''}`}
            />
          </InsightActionButton>
        )}
      />
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
              <div className="grid min-w-0 gap-2 min-[750px]:grid-cols-3 min-[750px]:gap-4">
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className="app-label app-label-compact">Average</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(averageRate)}
                    </p>
                    <p className="truncate text-right text-xs min-[750px]:mt-2 min-[750px]:text-left min-[750px]:text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      Completed months
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
                <div
                  ref={savingsRateChartRef}
                  className="relative h-full"
                  onMouseLeave={hideSavingsRateTooltip}
                >
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
                <BarChart
                  data={chartSeries}
                  margin={savingsRateChartMargin}
                  onMouseMove={(state, event) => showSavingsRateTooltip(state, event)}
                  onMouseLeave={hideSavingsRateTooltip}
                >
                  <XAxis
                    dataKey="monthKey"
                    axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
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
                  {savingsRateTooltipVisible && hoveredSavingsRatePoint && (
                    <ReferenceLine
                      x={hoveredSavingsRatePoint.monthKey}
                      stroke="var(--app-border-strong)"
                      strokeWidth={1}
                    />
                  )}
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
              <div
                ref={savingsRateTooltipRef}
                className="app-chart-tooltip-default-content pointer-events-none absolute left-0 top-0 z-20 min-w-48"
                onTransitionEnd={handleSavingsRateTooltipTransitionEnd}
                style={{
                  opacity: savingsRateTooltipVisible ? 1 : 0,
                  transition: 'opacity 150ms ease-out',
                  transform: 'translate3d(var(--savings-rate-tooltip-x, 0px), var(--savings-rate-tooltip-y, 0px), 0)',
                }}
              >
                {hoveredSavingsRatePoint && (
                  <SavingsRateHistoryTooltipContent
                    point={hoveredSavingsRatePoint}
                    displayCurrency={displaySnapshot.displayCurrency}
                  />
                )}
              </div>
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
