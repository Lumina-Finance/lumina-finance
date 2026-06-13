import { useMemo } from 'react'
import type { BreakdownMode } from '@/pages/insights/components/income-expense-breakdown-card/Card'
import type { InsightsCardQueries } from '@/pages/insights/hooks/useInsightsCardQueries'
import type { InsightsRangeInputDates } from '@/pages/insights/types/range'
import { getCashFlowBarData } from '@/pages/insights/utils/cashFlow'
import { getFundFlowCardData } from '@/pages/insights/utils/fundFlow'
import {
  getBreakdownEntriesForMode,
  getBreakdownTotalForMode,
  getCategoryTrendSections,
} from '@/pages/insights/utils/incomeExpenseBreakdown'
import { getMerchantDistributionMerchants } from '@/pages/insights/utils/merchantDistribution'
import { getMerchantRankingRows } from '@/pages/insights/utils/merchantRanking'
import { getNetWorthCardData } from '@/pages/insights/utils/netWorth'
import { getPeriodGlanceCardData } from '@/pages/insights/utils/periodGlance'
import { getSavingsRateHistory } from '@/pages/insights/utils/savingsRateTrend'

type UseInsightsCardDataParams = {
  queries: InsightsCardQueries
  displayCurrency: string
  rangeInputDates: InsightsRangeInputDates
  breakdownMode: BreakdownMode
}

/**
 * Converts insights API responses into the view models consumed by each insights card
 */
export function useInsightsCardData({
  queries,
  displayCurrency,
  rangeInputDates,
  breakdownMode,
}: UseInsightsCardDataParams) {
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
      rangeInputDates.from,
      rangeInputDates.to,
    ),
    [queries.netWorth.data, rangeInputDates.from, rangeInputDates.to],
  )
  const cashFlowBars = useMemo(
    () => getCashFlowBarData(
      queries.cashFlow.data,
      rangeInputDates.from,
      rangeInputDates.to,
    ),
    [queries.cashFlow.data, rangeInputDates.from, rangeInputDates.to],
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

  return {
    selectedBreakdown,
    selectedBreakdownTotal,
    selectedCategoryTrendSections,
    periodGlanceData,
    fundFlowData,
    netWorthCardData,
    cashFlowBars,
    savingsRateHistory,
    merchantDistributionMerchants,
    rankedMerchants,
  }
}
