import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import type {
  PeriodGlancePrimaryMetric,
  PeriodGlanceSupportItem,
} from '@/insights/types/periodGlance'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { PeriodGlancePrimaryPanel } from './PrimaryPanel'
import { PeriodGlanceSupportGrid } from './SupportGrid'
import { SectionHeader } from '../SectionHeader'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'

type PeriodGlanceSnapshot = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string
}

type PeriodGlanceCardProps = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string
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
  loading = false,
  transitionKey,
}: PeriodGlanceCardProps) {
  const incomingSnapshot = useMemo<PeriodGlanceSnapshot>(() => ({
    primaryMetric,
    supportItems,
    income,
    expenses,
    incomeExpenseFxStatus,
    displayCurrency,
  }), [displayCurrency, expenses, income, incomeExpenseFxStatus, primaryMetric, supportItems])
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
      <SectionHeader icon={Sparkles} label="This Period at a Glance" />

      <div className="relative overflow-hidden" data-tooltip-bounds>
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
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
