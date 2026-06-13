import { useMemo } from 'react'
import { useInsightCardVisibility } from '@/pages/insights/hooks/useInsightCardVisibility'

type InsightsCardVisibility = {
  periodGlance: boolean
  fundFlow: boolean
  breakdown: boolean
  netWorth: boolean
  cashFlow: boolean
  savingsRate: boolean
  merchantDistribution: boolean
  merchantRanking: boolean
}

/**
 * Creates card visibility refs and query-enablement flags for the insights grid
 */
export function useInsightsCardVisibilityMap() {
  const [periodGlanceRef, periodGlanceVisible] = useInsightCardVisibility()
  const [fundFlowRef, fundFlowVisible] = useInsightCardVisibility()
  const [breakdownRef, breakdownVisible] = useInsightCardVisibility()
  const [netWorthRef, netWorthVisible] = useInsightCardVisibility()
  const [cashFlowRef, cashFlowVisible] = useInsightCardVisibility()
  const [savingsRateRef, savingsRateVisible] = useInsightCardVisibility()
  const [merchantDistributionRef, merchantDistributionVisible] = useInsightCardVisibility()
  const [merchantRankingRef, merchantRankingVisible] = useInsightCardVisibility()

  return useMemo<{
    periodGlanceRef: typeof periodGlanceRef
    fundFlowRef: typeof fundFlowRef
    breakdownRef: typeof breakdownRef
    netWorthRef: typeof netWorthRef
    cashFlowRef: typeof cashFlowRef
    savingsRateRef: typeof savingsRateRef
    merchantDistributionRef: typeof merchantDistributionRef
    merchantRankingRef: typeof merchantRankingRef
    visibility: InsightsCardVisibility
  }>(() => ({
    periodGlanceRef,
    fundFlowRef,
    breakdownRef,
    netWorthRef,
    cashFlowRef,
    savingsRateRef,
    merchantDistributionRef,
    merchantRankingRef,
    visibility: {
      periodGlance: periodGlanceVisible,
      fundFlow: fundFlowVisible,
      breakdown: breakdownVisible,
      netWorth: netWorthVisible,
      cashFlow: cashFlowVisible,
      savingsRate: savingsRateVisible,
      merchantDistribution: merchantDistributionVisible,
      merchantRanking: merchantRankingVisible,
    },
  }), [
    breakdownRef,
    breakdownVisible,
    cashFlowRef,
    cashFlowVisible,
    fundFlowRef,
    fundFlowVisible,
    merchantDistributionRef,
    merchantDistributionVisible,
    merchantRankingRef,
    merchantRankingVisible,
    netWorthRef,
    netWorthVisible,
    periodGlanceRef,
    periodGlanceVisible,
    savingsRateRef,
    savingsRateVisible,
  ])
}
