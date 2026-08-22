import { useState } from 'react'
import {
  type InsightsBreakdownCategoryKind,
  useDeleteSavedInsightsRange,
  useSaveInsightsRange,
  useSavedInsightsRanges,
} from '@/api/insights'
import { useAuth } from '@/hooks/useAuth'
import { CashFlowCard } from './components/cash-flow-card/Card'
import { IncomeExpenseBreakdownCard } from './components/income-expense-breakdown-card/Card'
import { InsightsFloatingRangeControl } from './components/FloatingRangeControl'
import { MerchantDistributionCard } from './components/merchant-distribution-card/Card'
import { MerchantRankingCard } from './components/merchant-ranking-card/Card'
import { FundFlowCard } from './components/fund-flow-card/Card'
import { NetWorthCard } from './components/net-worth-card/Card'
import { PeriodGlanceCard } from './components/period-glance-card/Card'
import { SavingsRateTrendCard } from './components/savings-rate-trend-card/Card'
import { useInsightsCardData } from './hooks/useInsightsCardData'
import { useInsightsCardQueries } from './hooks/useInsightsCardQueries'
import { useInsightsCardVisibilityMap } from './hooks/useInsightsCardVisibilityMap'
import { useInsightsRange } from './hooks/useInsightsRange'
import type { NetWorthViewMode } from './utils/netWorth'

/**
 * Coordinates insight range controls, card modes, query state, and the insights card layout
 */
export default function InsightsPage() {
  const { user } = useAuth()
  const [breakdownMode, setBreakdownMode] = useState<InsightsBreakdownCategoryKind>('expense')
  const [netWorthMode, setNetWorthMode] = useState<NetWorthViewMode>('overview')
  const [capSavingsRateChart, setCapSavingsRateChart] = useState(false)
  const range = useInsightsRange()
  const savedRangesQuery = useSavedInsightsRanges()
  const saveRange = useSaveInsightsRange()
  const deleteRange = useDeleteSavedInsightsRange()

  /**
   * Saves the active relative window, letting the control surface a conflicting name
   */
  /**
   * Saves the builder draft under a name, then commits it as the applied range so the cards and
   * pill switch to it once the save succeeds
   */
  async function handleSaveCurrentRange(name: string) {
    await saveRange.mutateAsync({
      name,
      amount: range.draftAmount,
      unit: range.draftUnit,
      qualifier: range.draftQualifier,
    })
    range.applyDraft(name)
  }

  const {
    periodGlanceRef,
    fundFlowRef,
    breakdownRef,
    netWorthRef,
    cashFlowRef,
    savingsRateRef,
    merchantDistributionRef,
    merchantRankingRef,
    visibility,
  } = useInsightsCardVisibilityMap()
  const queries = useInsightsCardQueries({
    rangeInputDates: range.rangeInputDates,
    comparisonPeriod: range.comparisonPeriod,
    cardQueriesEnabled: range.cardQueriesEnabled,
    visibility,
  })
  const displayCurrency = user?.base_currency ?? 'CAD'
  const cardData = useInsightsCardData({
    queries,
    displayCurrency,
    rangeInputDates: range.rangeInputDates,
    breakdownMode,
  })

  return (
    <div className="relative">
      <div className="min-[1050px]:pr-[25rem]">
        <header className="app-page-header">
          <h1 className="app-page-title">Insights</h1>
          <p className="app-page-description">
            See where your money goes, spot patterns, and take control with confidence.
          </p>
        </header>
      </div>

      <InsightsFloatingRangeControl
        selectedPreset={range.selectedPreset}
        appliedPreset={range.appliedPreset}
        appliedAmount={range.appliedAmount}
        appliedUnit={range.appliedUnit}
        appliedQualifier={range.appliedQualifier}
        appliedSavedRangeName={range.appliedSavedRangeName}
        resolvedFrom={range.rangeInputDates.from}
        resolvedTo={range.rangeInputDates.to}
        draftAmount={range.draftAmount}
        draftUnit={range.draftUnit}
        draftQualifier={range.draftQualifier}
        draftFrom={range.draftInputDates.from}
        draftTo={range.draftInputDates.to}
        savedRanges={savedRangesQuery.data ?? []}
        onSelectPreset={range.selectPreset}
        onRevertSelection={range.revertSelection}
        onDraftAmountChange={range.setDraftAmount}
        onDraftUnitChange={range.setDraftUnit}
        onDraftQualifierChange={range.setDraftQualifier}
        onApplyDraft={range.applyDraft}
        onSaveCurrentRange={handleSaveCurrentRange}
        onApplySavedRange={range.applySavedRange}
        onDeleteSavedRange={deleteRange.mutate}
      />

      <div className="space-y-4 pb-28 min-[1050px]:pb-0">
        <div ref={periodGlanceRef}>
          <PeriodGlanceCard
            primaryMetric={cardData.periodGlanceData.primaryMetric}
            supportItems={cardData.periodGlanceData.supportItems}
            income={cardData.periodGlanceData.income}
            expenses={cardData.periodGlanceData.expenses}
            incomeExpenseFxStatus={queries.periodGlance.data?.income_expense_fx_status}
            displayCurrency={displayCurrency}
            error={queries.periodGlance.error}
            failed={queries.periodGlance.isError}
            hasContent={queries.periodGlance.data !== undefined}
            loading={queries.periodGlance.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={fundFlowRef}>
          <FundFlowCard
            flowData={cardData.fundFlowData.flowData}
            incomeSources={cardData.fundFlowData.incomeSources}
            expenseCategories={cardData.fundFlowData.expenseCategories}
            incomeOutflows={cardData.fundFlowData.incomeOutflows}
            expenseInflows={cardData.fundFlowData.expenseInflows}
            incomeSourceCount={cardData.fundFlowData.incomeSourceCount}
            expenseCategoryCount={cardData.fundFlowData.expenseCategoryCount}
            fxStatus={queries.fundFlow.data?.fx_status}
            displayCurrency={displayCurrency}
            error={queries.fundFlow.error}
            failed={queries.fundFlow.isError}
            hasContent={queries.fundFlow.data !== undefined}
            loading={queries.fundFlow.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={breakdownRef}>
          <IncomeExpenseBreakdownCard
            mode={breakdownMode}
            onModeToggle={() => setBreakdownMode((mode) => (mode === 'expense' ? 'income' : 'expense'))}
            entries={cardData.selectedBreakdown}
            total={cardData.selectedBreakdownTotal}
            trendSections={cardData.selectedCategoryTrendSections}
            fxStatus={queries.incomeExpenseBreakdown.data?.fx_status}
            displayCurrency={displayCurrency}
            animationKey={`${breakdownMode}-${range.cardTransitionKey}`}
            error={queries.incomeExpenseBreakdown.error}
            failed={queries.incomeExpenseBreakdown.isError}
            hasContent={queries.incomeExpenseBreakdown.data !== undefined}
            loading={queries.incomeExpenseBreakdown.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={netWorthRef}>
          <NetWorthCard
            mode={netWorthMode}
            onModeToggle={() => setNetWorthMode((mode) => (mode === 'overview' ? 'composition' : 'overview'))}
            groups={cardData.netWorthCardData.groups}
            baseline={cardData.netWorthCardData.baseline}
            series={cardData.netWorthCardData.series}
            fxStatus={queries.netWorth.data?.fx_status}
            displayCurrency={displayCurrency}
            error={queries.netWorth.error}
            failed={queries.netWorth.isError}
            hasContent={queries.netWorth.data !== undefined}
            loading={queries.netWorth.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={cashFlowRef}>
          <CashFlowCard
            granularity={cardData.cashFlowBars.granularity}
            buckets={cardData.cashFlowBars.buckets}
            fxStatus={queries.cashFlow.data?.fx_status}
            displayCurrency={displayCurrency}
            error={queries.cashFlow.error}
            failed={queries.cashFlow.isError}
            hasContent={queries.cashFlow.data !== undefined}
            loading={queries.cashFlow.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={savingsRateRef}>
          <SavingsRateTrendCard
            series={cardData.savingsRateHistory}
            fxStatus={queries.savingsRateTrend.data?.fx_status}
            displayCurrency={displayCurrency}
            capRates={capSavingsRateChart}
            onCapRatesToggle={() => setCapSavingsRateChart((current) => !current)}
            error={queries.savingsRateTrend.error}
            failed={queries.savingsRateTrend.isError}
            hasContent={queries.savingsRateTrend.data !== undefined}
            loading={queries.savingsRateTrend.isFetching}
            transitionKey="savings-rate-trend"
          />
        </div>

        <section className="grid gap-4 min-[1300px]:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={merchantDistributionRef} className="min-w-0">
            <MerchantDistributionCard
              merchants={cardData.merchantDistributionMerchants}
              fxStatus={queries.merchants.data?.fx_status}
              currency={displayCurrency}
              error={queries.merchants.error}
              failed={queries.merchants.isError}
              hasContent={queries.merchants.data !== undefined}
              loading={queries.merchants.isFetching}
              transitionKey={range.cardTransitionKey}
            />
          </div>

          <div ref={merchantRankingRef} className="min-w-0">
            <MerchantRankingCard
              merchants={cardData.rankedMerchants}
              fxStatus={queries.merchants.data?.fx_status}
              currency={displayCurrency}
              error={queries.merchants.error}
              failed={queries.merchants.isError}
              hasContent={queries.merchants.data !== undefined}
              loading={queries.merchants.isFetching}
              transitionKey={range.cardTransitionKey}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
