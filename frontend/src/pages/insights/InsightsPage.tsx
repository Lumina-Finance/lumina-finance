import { useState } from 'react'
import {
  useDeleteSavedInsightsRange,
  useSaveInsightsRange,
  useSavedInsightsRanges,
} from '@/api/insights'
import { useAuth } from '@/hooks/useAuth'
import { CashFlowCard } from './components/cash-flow-card/Card'
import {
  IncomeExpenseBreakdownCard,
  type BreakdownMode,
} from './components/income-expense-breakdown-card/Card'
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
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('expense')
  const [netWorthMode, setNetWorthMode] = useState<NetWorthViewMode>('overview')
  const [capSavingsRateChart, setCapSavingsRateChart] = useState(false)
  const range = useInsightsRange()
  const savedRangesQuery = useSavedInsightsRanges()
  const saveRange = useSaveInsightsRange()
  const deleteRange = useDeleteSavedInsightsRange()

  /**
   * Saves the active relative window, letting the control surface a conflicting name
   */
  async function handleSaveCurrentRange(name: string) {
    await saveRange.mutateAsync({
      name,
      amount: range.relativeAmount,
      unit: range.relativeUnit,
      qualifier: range.relativeQualifier,
    })
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
        preset={range.rangePreset}
        relativeAmount={range.relativeAmount}
        relativeUnit={range.relativeUnit}
        relativeQualifier={range.relativeQualifier}
        resolvedFrom={range.rangeInputDates.from}
        resolvedTo={range.rangeInputDates.to}
        appliedSavedRangeName={range.appliedSavedRangeName}
        savedRanges={savedRangesQuery.data ?? []}
        onPresetChange={range.setRangePreset}
        onRelativeAmountChange={range.setRelativeAmount}
        onRelativeUnitChange={range.setRelativeUnit}
        onRelativeQualifierChange={range.setRelativeQualifier}
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
              loading={queries.merchants.isFetching}
              transitionKey={range.cardTransitionKey}
            />
          </div>

          <div ref={merchantRankingRef} className="min-w-0">
            <MerchantRankingCard
              merchants={cardData.rankedMerchants}
              fxStatus={queries.merchants.data?.fx_status}
              currency={displayCurrency}
              loading={queries.merchants.isFetching}
              transitionKey={range.cardTransitionKey}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
