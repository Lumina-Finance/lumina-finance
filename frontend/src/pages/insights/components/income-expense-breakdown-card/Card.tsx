import { useCallback, useMemo } from 'react'
import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import type { InsightsBreakdownCategoryKind } from '@/api/insights'
import type { FxStatus } from '@/api/shared/fx'
import LoadFailure from '@/components/errors/LoadFailure'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/loading/Transition'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { AppSlotMachineText } from '@/components/display/SlotMachineText'
import { getIncomeExpenseBreakdownFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { InsightCalculationTooltip } from '@/pages/insights/components/CalculationTooltip'
import { InsightActionButton } from '@/pages/insights/components/ActionButton'
import { IncomeExpensePieChart } from './PieChart'
import { IncomeExpenseTrendSections } from './TrendSections'
import { InsightSectionHeader } from '@/pages/insights/components/SectionHeader'
import {
  getBreakdownCalculation,
} from '@/pages/insights/utils/incomeExpenseBreakdownDisplay'
import type {
  BreakdownEntry,
  CategoryTrendSection,
} from '@/pages/insights/types/incomeExpenseBreakdown'
import type { InsightsRangeInputDates } from '@/pages/insights/types/range'

type IncomeExpenseBreakdownCardProps = {
  range: InsightsRangeInputDates
  onCategorySelect: (categoryId: string, displayedRange: InsightsRangeInputDates) => void
  mode: InsightsBreakdownCategoryKind
  onModeToggle: () => void
  entries: BreakdownEntry[]
  total: number
  trendSections: CategoryTrendSection[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  animationKey: string

  /** The rejection this card's request reported */
  error: unknown

  failed: boolean

  loading?: boolean
  transitionKey: string
}

type IncomeExpenseBreakdownSnapshot = {
  /** The inclusive query range that produced these entries, retained until their replacement reveals */
  range: InsightsRangeInputDates
  mode: InsightsBreakdownCategoryKind
  entries: BreakdownEntry[]
  total: number
  trendSections: CategoryTrendSection[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  animationKey: string
  error: unknown
  failed: boolean
}

/**
 * Renders the income and expense breakdown card with chart and trend sections
 */
export function IncomeExpenseBreakdownCard({
  range,
  onCategorySelect,
  mode,
  onModeToggle,
  entries,
  total,
  trendSections,
  fxStatus,
  displayCurrency,
  animationKey,
  error,
  failed,
  loading = false,
  transitionKey,
}: IncomeExpenseBreakdownCardProps) {
  // The failure travels in the snapshot rather than beside it, so the box arrives with the reveal
  // instead of growing the card while the spinner is still turning
  const incomingSnapshot = useMemo<IncomeExpenseBreakdownSnapshot>(() => ({
    range,
    mode,
    entries,
    total,
    trendSections,
    fxStatus,
    displayCurrency,
    animationKey,
    error,
    failed,
  }), [animationKey, displayCurrency, entries, error, failed, fxStatus, mode, range, total, trendSections])
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
  const selectDisplayedCategory = useCallback((categoryId: string) => {
    onCategorySelect(categoryId, displaySnapshot.range)
  }, [displaySnapshot.range, onCategorySelect])

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
              <FxStatusBadge
                label="Income and expense breakdown FX status"
                fxStatus={displaySnapshot.fxStatus}
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
          {displaySnapshot.failed && (
            <LoadFailure
              error={displaySnapshot.error}
              standalone
              subject={displaySnapshot.mode === 'expense' ? 'Expense breakdown' : 'Income breakdown'}
            />
          )}

          {!displaySnapshot.failed && (
            <div className="grid gap-6 min-[1350px]:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
              <IncomeExpensePieChart
                onCategorySelect={selectDisplayedCategory}
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
          )}
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
