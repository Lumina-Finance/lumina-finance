import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import type {
  PeriodGlancePrimaryMetric,
  PeriodGlanceSupportItem,
} from '@/pages/insights/types/periodGlance'
import LoadFailure from '@/components/errors/LoadFailure'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/loading/Transition'
import { PeriodGlancePrimaryPanel } from './PrimaryPanel'
import { PeriodGlanceSupportGrid } from './SupportGrid'
import { InsightSectionHeader } from '@/pages/insights/components/SectionHeader'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'

type PeriodGlanceSnapshot = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string
  error: unknown
  failed: boolean
  hasContent: boolean
}

type PeriodGlanceCardProps = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string

  /** The rejection this card's request reported */
  error: unknown

  failed: boolean

  /** Whether the request has ever come back, since the metrics read zero either way */
  hasContent: boolean

  loading?: boolean
  transitionKey: string
}

/**
 * Renders the period glance summary and supporting insight metrics
 */
export function PeriodGlanceCard({
  primaryMetric,
  supportItems,
  income,
  expenses,
  incomeExpenseFxStatus,
  displayCurrency,
  error,
  failed,
  hasContent,
  loading = false,
  transitionKey,
}: PeriodGlanceCardProps) {
  // The failure travels in the snapshot rather than beside it, so the box arrives with the reveal
  // instead of growing the card while the spinner is still turning
  const incomingSnapshot = useMemo<PeriodGlanceSnapshot>(() => ({
    primaryMetric,
    supportItems,
    income,
    expenses,
    incomeExpenseFxStatus,
    displayCurrency,
    error,
    failed,
    hasContent,
  }), [displayCurrency, error, expenses, failed, hasContent, income, incomeExpenseFxStatus, primaryMetric, supportItems])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })

  return (
    <section className="app-card">
      <InsightSectionHeader icon={Sparkles} label="This Period at a Glance" />

      <div className="relative overflow-hidden" data-tooltip-bounds>
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          {displaySnapshot.failed && (
            <LoadFailure error={displaySnapshot.error} subject="This period at a glance" />
          )}

          {(!displaySnapshot.failed || displaySnapshot.hasContent) && (
            <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
              <PeriodGlancePrimaryPanel
                primaryMetric={displaySnapshot.primaryMetric}
                income={displaySnapshot.income}
                expenses={displaySnapshot.expenses}
                incomeExpenseFxStatus={displaySnapshot.incomeExpenseFxStatus}
                displayCurrency={displaySnapshot.displayCurrency}
              />
              <PeriodGlanceSupportGrid supportItems={displaySnapshot.supportItems} />
            </div>
          )}
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading period at a glance"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
