import { useMemo } from 'react'
import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/loading/LoadingTransition'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { AppSlotMachineText } from '@/components/display/AppSlotMachineText'
import { getIncomeExpenseBreakdownFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { InsightFxStatusBadge } from '../InsightFxStatusBadge'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { InsightActionButton } from '../InsightActionButton'
import { IncomeExpensePieChart } from './IncomeExpensePieChart'
import { IncomeExpenseTrendSections } from './IncomeExpenseTrendSections'
import { InsightSectionHeader } from '../InsightSectionHeader'
import {
  getBreakdownCalculation,
} from '@/pages/insights/utils/incomeExpenseBreakdownDisplay'
import type {
  BreakdownEntry,
  BreakdownMode,
  CategoryTrendSection,
} from '@/pages/insights/types/incomeExpenseBreakdown'

export type { BreakdownMode } from '@/pages/insights/types/incomeExpenseBreakdown'

type IncomeExpenseBreakdownCardProps = {
  mode: BreakdownMode
  onModeToggle: () => void
  entries: BreakdownEntry[]
  total: number
  trendSections: CategoryTrendSection[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  animationKey: string
  loading?: boolean
  transitionKey: string
}

type IncomeExpenseBreakdownSnapshot = {
  mode: BreakdownMode
  entries: BreakdownEntry[]
  total: number
  trendSections: CategoryTrendSection[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  animationKey: string
}

/**
 * Renders the income and expense breakdown card with chart and trend sections
 */
export function IncomeExpenseBreakdownCard({
  mode,
  onModeToggle,
  entries,
  total,
  trendSections,
  fxStatus,
  displayCurrency,
  animationKey,
  loading = false,
  transitionKey,
}: IncomeExpenseBreakdownCardProps) {
  const incomingSnapshot = useMemo<IncomeExpenseBreakdownSnapshot>(() => ({
    mode,
    entries,
    total,
    trendSections,
    fxStatus,
    displayCurrency,
    animationKey,
  }), [animationKey, displayCurrency, entries, fxStatus, mode, total, trendSections])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<IncomeExpenseBreakdownSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })

  return (
    <section className="app-card">
      <InsightSectionHeader
        icon={PieChartIcon}
        label={(
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-baseline whitespace-nowrap">
              <AppSlotMachineText text={displaySnapshot.mode === 'expense' ? 'Expense' : 'Income'} />
              <span className="ml-[0.25em]">Breakdown</span>
            </span>
            <InsightCalculationTooltip
              label={`${displaySnapshot.mode === 'expense' ? 'Expense' : 'Income'} Breakdown`}
              calculation={getBreakdownCalculation(displaySnapshot.mode)}
            />
            {displaySnapshot.fxStatus && (
              <InsightFxStatusBadge
                label="Income and expense breakdown FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getIncomeExpenseBreakdownFxStatusMessage}
              />
            )}
          </span>
        )}
        action={(
          <InsightActionButton
            title={mode === 'expense' ? 'Show income breakdown' : 'Show expense breakdown'}
            ariaLabel={mode === 'expense' ? 'Show income breakdown' : 'Show expense breakdown'}
            onPress={onModeToggle}
          >
            <Repeat size={12} />
          </InsightActionButton>
        )}
      />
      <div className="relative overflow-visible" data-tooltip-bounds>
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="grid gap-6 min-[1350px]:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
            <IncomeExpensePieChart
              mode={displaySnapshot.mode}
              entries={displaySnapshot.entries}
              total={displaySnapshot.total}
              displayCurrency={displaySnapshot.displayCurrency}
              animationKey={displaySnapshot.animationKey}
              shouldReduceMotion={shouldReduceMotion}
            />
            <IncomeExpenseTrendSections
              mode={displaySnapshot.mode}
              sections={displaySnapshot.trendSections}
              displayCurrency={displaySnapshot.displayCurrency}
              animationKey={displaySnapshot.animationKey}
              shouldReduceMotion={shouldReduceMotion}
            />
          </div>
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading income and expense breakdown"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
