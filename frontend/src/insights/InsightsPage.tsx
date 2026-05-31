import { useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { CashFlowCard } from './components/CashFlowCard'
import {
  IncomeExpenseBreakdownCard,
  type BreakdownMode,
} from './components/IncomeExpenseBreakdownCard'
import { InsightsFloatingRangeControl } from './components/InsightsFloatingRangeControl'
import { MerchantDistributionCard } from './components/MerchantDistributionCard'
import { MerchantRankingCard } from './components/MerchantRankingCard'
import { FundFlowCard } from './components/FundFlowCard'
import { NetWorthCard } from './components/NetWorthCard'
import { PeriodGlanceCard } from './components/PeriodGlanceCard'
import { SavingsRateTrendCard } from './components/SavingsRateTrendCard'
import { useInsightsCardQueries } from './hooks/useInsightsCardQueries'
import { useInsightCardVisibility } from './hooks/useInsightCardVisibility'
import { useInsightsRange } from './hooks/useInsightsRange'
import { getCashFlowBarData } from './utils/cashFlow'
import {
  getBreakdownEntriesForMode,
  getBreakdownTotalForMode,
  getCategoryTrendSections,
} from './utils/incomeExpenseBreakdown'
import { getFundFlowCardData } from './utils/fundFlow'
import { getMerchantDistributionMerchants } from './utils/merchantDistribution'
import { getMerchantRankingRows } from './utils/merchantRanking'
import { getNetWorthCardData, type NetWorthViewMode } from './utils/netWorth'
import { getPeriodGlanceCardData } from './utils/periodGlance'
import { getSavingsRateHistory } from './utils/savingsRateTrend'

export default function InsightsPage() {
  const { user } = useAuth()
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('expense')
  const [netWorthMode, setNetWorthMode] = useState<NetWorthViewMode>('overview')
  const [capSavingsRateChart, setCapSavingsRateChart] = useState(false)
  const range = useInsightsRange()
  const [periodGlanceCardRef, periodGlanceCardVisible] = useInsightCardVisibility()
  const [fundFlowCardRef, fundFlowCardVisible] = useInsightCardVisibility()
  const [breakdownCardRef, breakdownCardVisible] = useInsightCardVisibility()
  const [netWorthCardRef, netWorthCardVisible] = useInsightCardVisibility()
  const [cashFlowCardRef, cashFlowCardVisible] = useInsightCardVisibility()
  const [savingsRateCardRef, savingsRateCardVisible] = useInsightCardVisibility()
  const [merchantDistributionCardRef, merchantDistributionCardVisible] = useInsightCardVisibility()
  const [merchantRankingCardRef, merchantRankingCardVisible] = useInsightCardVisibility()
  const queries = useInsightsCardQueries({
    rangeInputDates: range.rangeInputDates,
    cardQueriesEnabled: range.cardQueriesEnabled,
    visibility: {
      periodGlance: periodGlanceCardVisible,
      fundFlow: fundFlowCardVisible,
      breakdown: breakdownCardVisible,
      netWorth: netWorthCardVisible,
      cashFlow: cashFlowCardVisible,
      savingsRate: savingsRateCardVisible,
      merchantDistribution: merchantDistributionCardVisible,
      merchantRanking: merchantRankingCardVisible,
    },
  })
  const displayCurrency = user?.base_currency ?? 'CAD'
  const selectedBreakdown = useMemo(
    () => getBreakdownEntriesForMode(queries.incomeExpenseBreakdown.data, breakdownMode),
    [breakdownMode, queries.incomeExpenseBreakdown.data],
  )
  const selectedBreakdownTotal = useMemo(
    () => getBreakdownTotalForMode(queries.incomeExpenseBreakdown.data, breakdownMode),
    [breakdownMode, queries.incomeExpenseBreakdown.data],
  )
  const selectedCategoryTrendSections = useMemo(
    () => getCategoryTrendSections(queries.incomeExpenseBreakdown.data, breakdownMode),
    [breakdownMode, queries.incomeExpenseBreakdown.data],
  )
  const periodGlanceData = useMemo(
    () => getPeriodGlanceCardData(queries.periodGlance.data, displayCurrency),
    [displayCurrency, queries.periodGlance.data],
  )
  const fundFlowData = useMemo(
    () => getFundFlowCardData(queries.fundFlow.data),
    [queries.fundFlow.data],
  )
  const netWorthCardData = useMemo(
    () => getNetWorthCardData(
      queries.netWorth.data,
      range.rangeInputDates.from,
      range.rangeInputDates.to,
    ),
    [queries.netWorth.data, range.rangeInputDates.from, range.rangeInputDates.to],
  )
  const cashFlowBars = useMemo(
    () => getCashFlowBarData(
      queries.cashFlow.data,
      range.rangeInputDates.from,
      range.rangeInputDates.to,
    ),
    [queries.cashFlow.data, range.rangeInputDates.from, range.rangeInputDates.to],
  )
  const savingsRateHistory = useMemo(
    () => getSavingsRateHistory(queries.savingsRateTrend.data),
    [queries.savingsRateTrend.data],
  )
  const merchantDistributionMerchants = useMemo(
    () => getMerchantDistributionMerchants(queries.merchants.data),
    [queries.merchants.data],
  )
  const rankedMerchants = useMemo(
    () => getMerchantRankingRows(queries.merchants.data),
    [queries.merchants.data],
  )

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
        fromDateValue={range.customFrom}
        toDateValue={range.customTo}
        customInvalid={range.customInvalid}
        onPresetChange={range.setRangePreset}
        onCustomFromChange={range.setCustomFrom}
        onCustomToChange={range.setCustomTo}
        onCustomRangeCommit={range.commitCustomRange}
      />

      <div className="space-y-4 pb-28 min-[1050px]:pb-0">
        <div ref={periodGlanceCardRef}>
          <PeriodGlanceCard
            primaryMetric={periodGlanceData.primaryMetric}
            supportItems={periodGlanceData.supportItems}
            income={periodGlanceData.income}
            expenses={periodGlanceData.expenses}
            incomeExpenseFxStatus={queries.periodGlance.data?.income_expense_fx_status}
            displayCurrency={displayCurrency}
            loading={queries.periodGlance.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={fundFlowCardRef}>
          <FundFlowCard
            flowData={fundFlowData.flowData}
            incomeSources={fundFlowData.incomeSources}
            expenseCategories={fundFlowData.expenseCategories}
            incomeOutflows={fundFlowData.incomeOutflows}
            expenseInflows={fundFlowData.expenseInflows}
            incomeSourceCount={fundFlowData.incomeSourceCount}
            expenseCategoryCount={fundFlowData.expenseCategoryCount}
            fxStatus={queries.fundFlow.data?.fx_status}
            displayCurrency={displayCurrency}
            loading={queries.fundFlow.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={breakdownCardRef}>
          <IncomeExpenseBreakdownCard
            mode={breakdownMode}
            onModeToggle={() => setBreakdownMode((mode) => (mode === 'expense' ? 'income' : 'expense'))}
            entries={selectedBreakdown}
            total={selectedBreakdownTotal}
            trendSections={selectedCategoryTrendSections}
            fxStatus={queries.incomeExpenseBreakdown.data?.fx_status}
            displayCurrency={displayCurrency}
            animationKey={`${breakdownMode}-${range.cardTransitionKey}`}
            loading={queries.incomeExpenseBreakdown.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={netWorthCardRef}>
          <NetWorthCard
            mode={netWorthMode}
            onModeToggle={() => setNetWorthMode((mode) => (mode === 'overview' ? 'composition' : 'overview'))}
            groups={netWorthCardData.groups}
            series={netWorthCardData.series}
            fxStatus={queries.netWorth.data?.fx_status}
            displayCurrency={displayCurrency}
            loading={queries.netWorth.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={cashFlowCardRef}>
          <CashFlowCard
            granularity={cashFlowBars.granularity}
            buckets={cashFlowBars.buckets}
            fxStatus={queries.cashFlow.data?.fx_status}
            displayCurrency={displayCurrency}
            loading={queries.cashFlow.isFetching}
            transitionKey={range.cardTransitionKey}
          />
        </div>

        <div ref={savingsRateCardRef}>
          <SavingsRateTrendCard
            series={savingsRateHistory}
            fxStatus={queries.savingsRateTrend.data?.fx_status}
            displayCurrency={displayCurrency}
            capRates={capSavingsRateChart}
            onCapRatesToggle={() => setCapSavingsRateChart((current) => !current)}
            loading={queries.savingsRateTrend.isFetching}
            transitionKey="savings-rate-trend"
          />
        </div>

        <section className="grid gap-4 min-[1300px]:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={merchantDistributionCardRef} className="min-w-0">
            <MerchantDistributionCard
              merchants={merchantDistributionMerchants}
              currency={displayCurrency}
              loading={queries.merchants.isFetching}
              transitionKey={range.cardTransitionKey}
            />
          </div>

          <div ref={merchantRankingCardRef} className="min-w-0">
            <MerchantRankingCard
              merchants={rankedMerchants}
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
