import { useMemo } from 'react'
import { CalendarDays } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { CashFlowBarChart } from './BarChart'
import type { CashFlowBarBucket, CashFlowGranularity } from '@/pages/insights/types/cashFlow'
import { getInsightsCashFlowFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { formatSignedCurrency, getSignedAmountColor } from '@/pages/insights/utils/money'
import { FxStatusBadge } from '../FxStatusBadge'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { SectionHeader } from '../SectionHeader'

type CashFlowCardProps = {
  granularity: CashFlowGranularity
  buckets: CashFlowBarBucket[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  loading?: boolean
  transitionKey: string
}

type CashFlowSnapshot = {
  granularity: CashFlowGranularity
  buckets: CashFlowBarBucket[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
}

const cashFlowCalculation = 'Bars group money moving in and out by period. Net equals inflow minus outflow. Transfers are included. Balance adjustments are excluded'
const netCashFlowCalculation = 'The cumulative net cash flow at the end of the chosen time range'

/**
 * Renders the cash flow insight card shell, total metric, chart, legend, and loading state
 */
export function CashFlowCard({
  granularity,
  buckets,
  fxStatus,
  displayCurrency,
  loading = false,
  transitionKey,
}: CashFlowCardProps) {
  const incomingSnapshot = useMemo<CashFlowSnapshot>(() => ({
    granularity,
    buckets,
    fxStatus,
    displayCurrency,
  }), [buckets, displayCurrency, fxStatus, granularity])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<CashFlowSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const label = displaySnapshot.granularity === 'day' ? 'Daily' : displaySnapshot.granularity === 'week' ? 'Weekly' : 'Monthly'
  const totalInflow = displaySnapshot.buckets.reduce((sum, bucket) => sum + bucket.inflow, 0)
  const totalOutflow = displaySnapshot.buckets.reduce((sum, bucket) => sum + bucket.outflow, 0)
  const totalNet = totalInflow - totalOutflow

  return (
    <section className="app-card">
      <SectionHeader
        icon={CalendarDays}
        label={(
          <span className="inline-flex items-center gap-2">
            Cash Flow
            <InsightCalculationTooltip
              label="Cash Flow"
              calculation={cashFlowCalculation}
            />
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Cash Flow FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getInsightsCashFlowFxStatusMessage}
              />
            )}
          </span>
        )}
      />
      <div className="relative overflow-visible" data-tooltip-bounds>
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="flex h-[390px] flex-col">
            <div className="mb-3">
              <p className="app-label app-label-compact inline-flex items-center gap-2">
                Net Cash Flow
                <InsightCalculationTooltip
                  label="Net Cash Flow"
                  calculation={netCashFlowCalculation}
                />
              </p>
              <p
                className="mt-1 font-financial text-3xl leading-none tracking-tight"
                style={{ color: getSignedAmountColor(totalNet) }}
              >
                {formatSignedCurrency(totalNet, displaySnapshot.displayCurrency)}
              </p>
            </div>
            <CashFlowBarChart
              buckets={displaySnapshot.buckets}
              displayCurrency={displaySnapshot.displayCurrency}
              emptyLabel="No cash flow in this range"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
              <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                {label} net cash flow. Hover a bar for inflow, outflow, and net
              </p>
              <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-chart-positive)' }} />
                  Net positive
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-chart-negative)' }} />
                  Net negative
                </span>
              </div>
            </div>
          </div>
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading cash flow"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
