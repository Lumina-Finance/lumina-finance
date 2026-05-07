import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react'
import {
  type SpendingRange,
  useSpendingComparison,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { formatCurrency } from '@/utils/formatCurrency'
import { TIME_SELECTOR_SPRING } from '@/dashboard/constants/animation'
import {
  CURRENT_LABEL_BY_RANGE,
  DASHBOARD_RANGE_OPTIONS,
  PREVIOUS_LABEL_BY_RANGE,
  PREVIOUS_PERIOD_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'
import { getSpendingComparisonSeries } from '@/dashboard/utils/getSpendingComparisonSeries'

type SpendingComparisonWidgetProps = {
  displayCurrency: string
}

export function SpendingComparisonWidget({ displayCurrency }: SpendingComparisonWidgetProps) {
  const shouldReduceMotion = useReducedMotion()
  const [spendingRange, setSpendingRange] = useState<SpendingRange>('MTD')
  const { data: spendingComparison, isLoading: spendingComparisonLoading } = useSpendingComparison(spendingRange)
  const spendingChartData = useMemo(
    () => getSpendingComparisonSeries(spendingComparison),
    [spendingComparison],
  )
  const currentSeries = spendingComparison?.current ?? []
  const previousSeries = spendingComparison?.previous ?? []
  const currentHasData = currentSeries.some((value) => value > 0)
  const previousHasData = previousSeries.some((value) => value > 0)
  const spentToDate = currentSeries.at(-1) ?? 0
  const previousAtSameOffset =
    currentSeries.length === 0
      ? null
      : previousSeries[Math.min(currentSeries.length, previousSeries.length) - 1] ?? null
  const spendingDeltaPct =
    previousAtSameOffset != null && previousAtSameOffset > 0
      ? ((spentToDate - previousAtSameOffset) / previousAtSameOffset) * 100
      : null
  const spendingDeltaText =
    spendingDeltaPct == null
      ? '+00.0%'
      : `${spendingDeltaPct >= 0 ? '+' : ''}${spendingDeltaPct.toFixed(1)}%`
  const amountLoadingText = formatCurrency(888888, displayCurrency)

  return (
    <div className="app-card h-[420px] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <BarChart3 size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label inline-flex items-baseline whitespace-nowrap">
          Spending vs. Last&nbsp;
          <AppSlotMachineText text={PREVIOUS_PERIOD_LABEL_BY_RANGE[spendingRange]} />
        </span>
        <div
          className="app-segmented-control app-segmented-control-compact app-time-selector ml-auto"
          role="tablist"
          aria-label="Spending range"
        >
          <motion.span
            className="app-time-selector-indicator"
            aria-hidden
            animate={{ x: `${DASHBOARD_RANGE_OPTIONS.indexOf(spendingRange) * 100}%` }}
            transition={shouldReduceMotion ? { duration: 0 } : TIME_SELECTOR_SPRING}
          />
          {DASHBOARD_RANGE_OPTIONS.map((option) => {
            const active = option === spendingRange
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSpendingRange(option)}
                className={`app-segmented-option app-segmented-option-compact ${active ? 'app-segmented-option-active' : ''}`}
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="font-financial font-normal tracking-tight leading-none text-3xl">
          <AppScrambledNumber
            text={formatCurrency(spentToDate, displayCurrency)}
            loading={spendingComparisonLoading}
            loadingText={amountLoadingText}
          />
        </p>
        {(spendingComparisonLoading || spendingDeltaPct != null) && (
          <div
            className="flex items-center text-sm font-medium"
            style={{
              color: spendingComparisonLoading || spendingDeltaPct == null
                ? 'var(--app-text-muted)'
                : spendingDeltaPct <= 0
                  ? 'var(--app-positive)'
                  : 'var(--app-negative)',
            }}
          >
            {!spendingComparisonLoading && spendingDeltaPct != null && (
              spendingDeltaPct <= 0 ? (
                <ArrowDownRight size={14} aria-hidden />
              ) : (
                <ArrowUpRight size={14} aria-hidden />
              )
            )}
            <AppScrambledNumber
              text={spendingDeltaText}
              loading={spendingComparisonLoading}
              loadingText="+00.0%"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-2 mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: 'var(--app-accent)',
              opacity: currentHasData ? 1 : 0.4,
            }}
          />
          <span
            className="text-xs"
            style={{
              color: 'var(--app-text-muted)',
              fontStyle: currentHasData ? 'normal' : 'italic',
            }}
          >
            {currentHasData
              ? CURRENT_LABEL_BY_RANGE[spendingRange]
              : `No data for ${CURRENT_LABEL_BY_RANGE[spendingRange].toLowerCase()}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: 'var(--app-text-muted)',
              opacity: previousHasData ? 1 : 0.4,
            }}
          />
          <span
            className="text-xs"
            style={{
              color: 'var(--app-text-muted)',
              fontStyle: previousHasData ? 'normal' : 'italic',
            }}
          >
            {previousHasData
              ? PREVIOUS_LABEL_BY_RANGE[spendingRange]
              : `No data for ${PREVIOUS_LABEL_BY_RANGE[spendingRange].toLowerCase()}`}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={spendingChartData}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          >
            <defs>
              <linearGradient id="spendCurrentFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--app-accent)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendPreviousFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-text-muted)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--app-text-muted)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={32}
              tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
              tickMargin={4}
            />
            <YAxis hide />
            <Tooltip
              wrapperClassName="app-chart-tooltip-default"
              cursor={{ stroke: 'var(--app-accent-border)', strokeWidth: 1 }}
              formatter={(value, name) => [
                formatCurrency(Number(value), displayCurrency),
                name === 'current' ? CURRENT_LABEL_BY_RANGE[spendingRange] : PREVIOUS_LABEL_BY_RANGE[spendingRange],
              ]}
            />
            <Area
              type="monotone"
              dataKey="previous"
              stroke="var(--app-text-muted)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="url(#spendPreviousFill)"
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="current"
              stroke="var(--app-accent)"
              strokeWidth={2.5}
              fill="url(#spendCurrentFill)"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
