import { useMemo } from 'react'
import { ArrowLeftRight, Minus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { getInsightsNetWorthFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { formatCurrency } from '@/utils/formatCurrency'
import { FxStatusBadge } from '../FxStatusBadge'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { InsightActionButton } from '../InsightActionButton'
import { NetWorthChart } from './Chart'
import { SectionHeader } from '../SectionHeader'
import {
  formatSignedNetWorthCurrency,
  getNetWorthChartData,
  getNetWorthChartItems,
  type NetWorthGroup,
  type NetWorthPoint,
  type NetWorthViewMode,
} from '../../utils/netWorthChart'

export type { NetWorthViewMode } from '../../utils/netWorthChart'

type NetWorthCardProps = {
  mode: NetWorthViewMode
  onModeToggle: () => void
  groups: NetWorthGroup[]
  baseline: number[]
  series: NetWorthPoint[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  loading?: boolean
  transitionKey: string
}

type NetWorthSnapshot = {
  mode: NetWorthViewMode
  groups: NetWorthGroup[]
  baseline: number[]
  series: NetWorthPoint[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  emptyLabel: string
}

/**
 * Describes the calculation currently shown by the net-worth card mode
 */
function getNetWorthCalculation(mode: NetWorthViewMode) {
  return mode === 'overview'
    ? 'Net worth is assets minus debt. Change compares with net worth from the day before this range'
    : 'Balances are grouped by account type at each chart date'
}

/**
 * Renders net-worth summary metrics and the net-worth history chart
 */
export function NetWorthCard({
  mode,
  onModeToggle,
  groups,
  baseline,
  series,
  fxStatus,
  displayCurrency,
  loading = false,
  transitionKey,
}: NetWorthCardProps) {
  const incomingSnapshot = useMemo<NetWorthSnapshot>(() => ({
    mode,
    groups,
    baseline,
    series,
    fxStatus,
    displayCurrency,
    emptyLabel: loading ? 'Loading net worth history...' : 'No net worth history in this range.',
  }), [baseline, displayCurrency, fxStatus, groups, loading, mode, series])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<NetWorthSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const latest = displaySnapshot.series.at(-1)
  const chartItems = useMemo(
    () => getNetWorthChartItems(displaySnapshot.groups, displaySnapshot.mode),
    [displaySnapshot.groups, displaySnapshot.mode],
  )
  const deltaSeries = useMemo(
    () => getNetWorthChartData(displaySnapshot.series, chartItems, displaySnapshot.mode, displaySnapshot.baseline),
    [chartItems, displaySnapshot.baseline, displaySnapshot.mode, displaySnapshot.series],
  )
  const latestChange = deltaSeries.at(-1)?.totalChange ?? 0
  const netWorthTrendColor = latestChange > 0
    ? 'var(--app-chart-positive)'
    : latestChange < 0
      ? 'var(--app-chart-negative)'
      : 'var(--app-text-muted)'
  const NetWorthTrendIcon = latestChange > 0 ? TrendingUp : latestChange < 0 ? TrendingDown : Minus

  return (
    <section className="app-card">
      <SectionHeader
        icon={Wallet}
        label={(
          <span className="inline-flex items-center gap-2">
            Net Worth
            <InsightCalculationTooltip
              label="Net Worth"
              calculation={getNetWorthCalculation(displaySnapshot.mode)}
            />
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Net Worth FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getInsightsNetWorthFxStatusMessage}
              />
            )}
          </span>
        )}
        action={(
          <InsightActionButton
            title={mode === 'overview' ? 'Show account type composition' : 'Show net worth change'}
            ariaLabel={mode === 'overview' ? 'Show account type composition' : 'Show net worth change'}
            onPress={onModeToggle}
          >
            <ArrowLeftRight size={12} />
          </InsightActionButton>
        )}
      />
      <div className="relative overflow-visible" data-tooltip-bounds>
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="flex h-[360px] flex-col">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="app-label app-label-compact inline-flex items-center gap-2">
                  Ending Net Worth
                  <InsightCalculationTooltip
                    label="Ending Net Worth"
                    calculation="Ending net worth value as of the last date in the chosen time period"
                  />
                </p>
                <div className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-1">
                  <p className="font-financial text-3xl leading-none tracking-tight">
                    {formatCurrency(latest?.total ?? 0, displaySnapshot.displayCurrency)}
                  </p>
                  <div className="flex items-center gap-1.5 text-sm font-medium leading-none" style={{ color: netWorthTrendColor }}>
                    <NetWorthTrendIcon size={14} aria-hidden />
                    <span className="font-financial">{formatSignedNetWorthCurrency(latestChange, displaySnapshot.displayCurrency)}</span>
                    <span style={{ color: 'var(--app-text-subtle)' }}>since start</span>
                  </div>
                </div>
              </div>
            </div>
            <NetWorthChart
              mode={displaySnapshot.mode}
              groups={displaySnapshot.groups}
              chartItems={chartItems}
              deltaSeries={deltaSeries}
              displayCurrency={displaySnapshot.displayCurrency}
              emptyLabel={displaySnapshot.emptyLabel}
              shouldReduceMotion={shouldReduceMotion}
            />
          </div>
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading net worth"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
