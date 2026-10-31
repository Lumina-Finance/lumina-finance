import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSavedInsightsRange,
  deleteSavedInsightsRange,
  fetchInsightsCashFlow,
  fetchInsightsFundFlow,
  fetchInsightsIncomeExpenseBreakdown,
  fetchInsightsMerchants,
  fetchInsightsNetWorth,
  fetchInsightsPeriodGlance,
  fetchInsightsSavingsRateTrend,
  fetchSavedInsightsRanges,
} from '@/api/insights/requests'
import { insightsKeys } from '@/api/cache/queryKeys'
import { getFxAwareStaleTime } from '@/api/shared/fxCache'
import { useAuth } from '@/hooks/useAuth'
import type { InsightsComparisonPeriod, SavedInsightsRange } from '@/api/insights/types'

const INSIGHTS_FX_STALE_TIME_MS = 5 * 60 * 1000

/**
 * Reads headline insights metrics for a comparison date range
 */
export function useInsightsPeriodGlance(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  enabled = true,
) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.periodGlance(fromDate, toDate, comparisonPeriod),
    queryFn: ({ signal }) => fetchInsightsPeriodGlance(fromDate, toDate, comparisonPeriod, signal),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads net worth history for an insights date range
 */
export function useInsightsNetWorth(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.netWorth(fromDate, toDate),
    queryFn: ({ signal }) => fetchInsightsNetWorth(fromDate, toDate, signal),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads the global savings-rate trend used by the insights page
 */
export function useInsightsSavingsRateTrend(enabled = true) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.savingsRateTrend(),
    queryFn: ({ signal }) => fetchInsightsSavingsRateTrend(signal),
    enabled: !!accessToken && enabled,
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads income and expense category movement for a comparison date range
 */
export function useInsightsIncomeExpenseBreakdown(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  enabled = true,
) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.incomeExpenseBreakdown(fromDate, toDate, comparisonPeriod),
    queryFn: ({ signal }) => fetchInsightsIncomeExpenseBreakdown(fromDate, toDate, comparisonPeriod, signal),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads cash-flow points for an insights date range
 */
export function useInsightsCashFlow(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.cashFlow(fromDate, toDate),
    queryFn: ({ signal }) => fetchInsightsCashFlow(fromDate, toDate, signal),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads income and expense flow groups for an insights date range
 */
export function useInsightsFundFlow(fromDate: string, toDate: string, enabled = true) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.fundFlow(fromDate, toDate),
    queryFn: ({ signal }) => fetchInsightsFundFlow(fromDate, toDate, signal),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads merchant distribution and ranking data for a comparison date range
 */
export function useInsightsMerchants(
  fromDate: string,
  toDate: string,
  comparisonPeriod: InsightsComparisonPeriod = 'same_length',
  enabled = true,
) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: insightsKeys.merchants(fromDate, toDate, comparisonPeriod),
    queryFn: ({ signal }) => fetchInsightsMerchants(fromDate, toDate, comparisonPeriod, signal),
    enabled: !!accessToken && enabled && fromDate !== '' && toDate !== '',
    staleTime: getFxAwareStaleTime(INSIGHTS_FX_STALE_TIME_MS),
  })
}

/**
 * Reads the user's saved relative insights ranges
 */
export function useSavedInsightsRanges(enabled = true) {
  const { accessToken } = useAuth()
  // Left at the default stale time, like the app's other lists. A range saved or deleted in another
  // session marks the cache changed, and the app's cache check then invalidates this list
  return useQuery({
    queryKey: insightsKeys.savedRanges(),
    queryFn: ({ signal }) => fetchSavedInsightsRanges(signal),
    enabled: !!accessToken && enabled,
  })
}

/**
 * Saves a named relative range and prepends it to the cached saved range list
 */
export function useSaveInsightsRange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createSavedInsightsRange,
    onSuccess: (savedRange) => {
      // Prepend the new range so the list stays newest-first without a refetch round-trip
      queryClient.setQueryData<SavedInsightsRange[]>(insightsKeys.savedRanges(), (ranges) =>
        ranges ? [savedRange, ...ranges] : [savedRange],
      )
    },
  })
}

/**
 * Deletes a saved relative range and drops it from the cached saved range list
 */
export function useDeleteSavedInsightsRange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteSavedInsightsRange,
    onSuccess: (_, rangeId) => {
      // Remove the deleted range in place so the exit animation plays without a refetch round-trip
      queryClient.setQueryData<SavedInsightsRange[]>(
        insightsKeys.savedRanges(),
        (ranges) => ranges?.filter((range) => range.id !== rangeId) ?? ranges,
      )
    },
  })
}
