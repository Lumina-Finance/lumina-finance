import {
  useInsightsCashFlow,
  useInsightsFundFlow,
  useInsightsIncomeExpenseBreakdown,
  useInsightsMerchants,
  useInsightsNetWorth,
  useInsightsPeriodGlance,
  useInsightsSavingsRateTrend,
  type InsightsComparisonPeriod,
} from '@/api/insights'
import type { InsightsRangeInputDates } from '@/pages/insights/types/range'

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

  /** Categories the merchant distribution is narrowed to, empty for every category */
  merchantCategoryIds: string[]
}

/**
 * Runs insights card queries only when the range is valid and each card is visible
 */
export function useInsightsCardQueries({
  rangeInputDates,
  comparisonPeriod,
  cardQueriesEnabled,
  visibility,
  merchantCategoryIds,
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
  // The ranking card stays unfiltered, so a narrowed distribution reads its own request and the
  // shared one then serves the ranking alone
  const isDistributionFiltered = merchantCategoryIds.length > 0
  const merchants = useInsightsMerchants(
    rangeInputDates.from,
    rangeInputDates.to,
    comparisonPeriod,
    cardQueriesEnabled && (visibility.merchantRanking || (visibility.merchantDistribution && !isDistributionFiltered)),
  )
  const filteredMerchants = useInsightsMerchants(
    rangeInputDates.from,
    rangeInputDates.to,
    comparisonPeriod,
    cardQueriesEnabled && visibility.merchantDistribution && isDistributionFiltered,
    merchantCategoryIds,
  )
  const merchantDistribution = isDistributionFiltered ? filteredMerchants : merchants
  const savingsRateTrend = useInsightsSavingsRateTrend(visibility.savingsRate)

  return {
    periodGlance,
    fundFlow,
    incomeExpenseBreakdown,
    netWorth,
    cashFlow,
    savingsRateTrend,
    merchants,
    merchantDistribution,
  }
}

export type InsightsCardQueries = ReturnType<typeof useInsightsCardQueries>
