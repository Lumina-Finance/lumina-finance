import {
  useInsightsCashFlow,
  useInsightsFundFlow,
  useInsightsIncomeExpenseBreakdown,
  useInsightsMerchants,
  useInsightsNetWorth,
  useInsightsPeriodGlance,
  useInsightsSavingsRateTrend,
} from '@/api/insights'
import type { InsightsComparisonPeriod, InsightsRangeInputDates } from '../types/range'

type InsightsCardQueryVisibility = {
  periodGlance: boolean
  fundFlow: boolean
  breakdown: boolean
  netWorth: boolean
  cashFlow: boolean
  savingsRate: boolean
  merchantDistribution: boolean
  merchantRanking: boolean
}

type UseInsightsCardQueriesParams = {
  rangeInputDates: InsightsRangeInputDates
  comparisonPeriod: InsightsComparisonPeriod
  cardQueriesEnabled: boolean
  visibility: InsightsCardQueryVisibility
}

export function useInsightsCardQueries({
  rangeInputDates,
  comparisonPeriod,
  cardQueriesEnabled,
  visibility,
}: UseInsightsCardQueriesParams) {
  const periodGlance = useInsightsPeriodGlance(
    rangeInputDates.from,
    rangeInputDates.to,
    comparisonPeriod,
    cardQueriesEnabled && visibility.periodGlance,
  )
  const fundFlow = useInsightsFundFlow(
    rangeInputDates.from,
    rangeInputDates.to,
    cardQueriesEnabled && visibility.fundFlow,
  )
  const incomeExpenseBreakdown = useInsightsIncomeExpenseBreakdown(
    rangeInputDates.from,
    rangeInputDates.to,
    comparisonPeriod,
    cardQueriesEnabled && visibility.breakdown,
  )
  const netWorth = useInsightsNetWorth(
    rangeInputDates.from,
    rangeInputDates.to,
    cardQueriesEnabled && visibility.netWorth,
  )
  const cashFlow = useInsightsCashFlow(
    rangeInputDates.from,
    rangeInputDates.to,
    cardQueriesEnabled && visibility.cashFlow,
  )
  const merchants = useInsightsMerchants(
    rangeInputDates.from,
    rangeInputDates.to,
    comparisonPeriod,
    cardQueriesEnabled && (visibility.merchantDistribution || visibility.merchantRanking),
  )
  const savingsRateTrend = useInsightsSavingsRateTrend(visibility.savingsRate)

  return {
    periodGlance,
    fundFlow,
    incomeExpenseBreakdown,
    netWorth,
    cashFlow,
    savingsRateTrend,
    merchants,
  }
}
