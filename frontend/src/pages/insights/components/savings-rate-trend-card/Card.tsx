import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpToLine, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import type { SavingsRateHistoryPoint } from '@/pages/insights/types/savingsRate'
import { getSavingsRateTrendFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { formatSavingsRateValue } from '@/pages/insights/utils/money'
import { getSavingsRateSummary } from '@/pages/insights/utils/savingsRateChart'
import { FxStatusBadge } from '../FxStatusBadge'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { InsightActionButton } from '../InsightActionButton'
import { SavingsRateChart } from './Chart'
import { SectionHeader } from '../SectionHeader'

type SavingsRateTrendCardProps = {
  series: SavingsRateHistoryPoint[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  capRates: boolean
  onCapRatesToggle: () => void
  loading?: boolean
  transitionKey: string
}

type SavingsRateTrendSnapshot = {
  series: SavingsRateHistoryPoint[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  capRates: boolean
  emptyLabel: string
}

const savingsRateCalculation = 'Monthly savings rate is income minus expenses, divided by income. Income and expense categories are netted first. Transfers are excluded'
const latestSavingsRateCalculation = 'Savings rate for the latest available month. The current month may be partial. Shows −∞% when expenses exist without income because the calculation divides by zero'
const averageSavingsRateCalculation = 'Average savings rate across completed months with income. The current month and no-income months are excluded'
const bestSavingsRateCalculation = 'Highest savings rate across completed months. The current month is excluded'
const worstSavingsRateCalculation = 'Lowest savings rate across completed months. The current month is excluded'
const savingsRateStatLabelClass = 'app-label inline-flex items-center gap-2 text-sm leading-5'
const savingsRateStatCaptionClass = 'truncate text-right text-xs leading-4 min-[750px]:mt-2 min-[750px]:text-left'

/**
 * Renders savings-rate summary metrics and the monthly savings-rate chart
 */
export function SavingsRateTrendCard({
  series,
  fxStatus,
  displayCurrency,
  capRates,
  onCapRatesToggle,
  loading = false,
  transitionKey,
}: SavingsRateTrendCardProps) {
  const incomingSnapshot = useMemo<SavingsRateTrendSnapshot>(() => ({
    series,
    fxStatus,
    displayCurrency,
    capRates,
    emptyLabel: loading ? 'Loading savings-rate history...' : 'No savings-rate history available',
  }), [capRates, displayCurrency, fxStatus, loading, series])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<SavingsRateTrendSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const {
    latestPoint,
    averageRate,
    bestPoint,
    worstPoint,
  } = getSavingsRateSummary(displaySnapshot.series)

  return (
    <section className="app-card">
      <SectionHeader
        icon={Repeat}
        label={(
          <span className="inline-flex items-center gap-2">
            Savings Rate Trend
            <InsightCalculationTooltip
              label="Savings Rate Trend"
              calculation={savingsRateCalculation}
            />
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Savings Rate Trend FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getSavingsRateTrendFxStatusMessage}
              />
            )}
          </span>
        )}
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
      <div className="relative overflow-visible" data-tooltip-bounds>
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="flex flex-col min-[750px]:h-[430px]">
            <div className="mb-4 grid gap-4 border-b border-[var(--app-border)] pb-4 min-[750px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)] min-[750px]:items-center min-[750px]:gap-6">
              <div className="min-w-0">
                <p className="app-label inline-flex items-center gap-2">
                  Latest Savings Rate
                  <InsightCalculationTooltip
                    label="Latest Savings Rate"
                    calculation={latestSavingsRateCalculation}
                  />
                </p>
                <p className="mt-1 font-financial text-4xl leading-none tracking-tight">
                  {formatSavingsRateValue(latestPoint?.rate ?? null)}
                </p>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
                  {latestPoint?.fullLabel ?? 'No recent month'}
                </p>
              </div>
              <div className="grid min-w-0 gap-2 min-[750px]:grid-cols-3 min-[750px]:gap-4">
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className={savingsRateStatLabelClass}>
                    Average
                    <InsightCalculationTooltip
                      label="Average Savings Rate"
                      calculation={averageSavingsRateCalculation}
                    />
                  </p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(averageRate)}
                    </p>
                    <p className={savingsRateStatCaptionClass} style={{ color: 'var(--app-text-muted)' }}>
                      Completed months with income
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className={savingsRateStatLabelClass}>
                    Best
                    <InsightCalculationTooltip
                      label="Best Savings Rate"
                      calculation={bestSavingsRateCalculation}
                    />
                  </p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(bestPoint?.rate ?? null)}
                    </p>
                    <p className={savingsRateStatCaptionClass} style={{ color: 'var(--app-text-muted)' }}>
                      {bestPoint?.fullLabel ?? 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-md border border-[var(--app-border)] px-2.5 py-2 min-[750px]:px-3 min-[750px]:py-2.5">
                  <p className={savingsRateStatLabelClass}>
                    Worst
                    <InsightCalculationTooltip
                      label="Worst Savings Rate"
                      calculation={worstSavingsRateCalculation}
                    />
                  </p>
                  <div className="mt-1 flex items-baseline justify-between gap-3 min-[750px]:block">
                    <p className="font-financial text-xl leading-none tracking-tight min-[750px]:text-2xl">
                      {formatSavingsRateValue(worstPoint?.rate ?? null)}
                    </p>
                    <p className={savingsRateStatCaptionClass} style={{ color: 'var(--app-text-muted)' }}>
                      {worstPoint?.fullLabel ?? 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <SavingsRateChart
              series={displaySnapshot.series}
              averageRate={averageRate}
              displayCurrency={displaySnapshot.displayCurrency}
              capRates={displaySnapshot.capRates}
              emptyLabel={displaySnapshot.emptyLabel}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
              <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                <span>Latest 12 months, up to available data</span>
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
                      Chart scale is capped at 100%
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
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading savings rate trend"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
