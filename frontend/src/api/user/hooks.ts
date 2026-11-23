import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  invalidateProfileUpdateCaches,
  updateRunwayAccountCaches,
  updateRunwaySettingsCaches,
} from '@/api/cache/updates/user'
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback'
import {
  changePassword,
  fetchDataExport,
  fetchFeatureGrants,
  fetchRunway,
  fetchRunwayAccounts,
  fetchRunwaySettings,
  requestEmailChange,
  updateProfile,
  updateRunwayAccounts,
  updateRunwaySettings,
} from '@/api/user/requests'
import { userKeys } from '@/api/cache/queryKeys'
import { getFxAwareStaleTime } from '@/api/shared/fxCache'
import { useAuth } from '@/hooks/useAuth'

const RUNWAY_FX_STALE_TIME_MS = 10 * 60 * 1000

// Asked again each time a page that reads it opens, since the features a user is granted can change
// between visits without any change to their data
const FEATURE_GRANTS_STALE_TIME_MS = 0

/**
 * The read of the features the current user is granted
 *
 * @param enabled - Whether to ask at all
 */
export function featureGrantsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: userKeys.featureGrants(),
    queryFn: ({ signal }) => fetchFeatureGrants(signal),
    enabled,
    staleTime: FEATURE_GRANTS_STALE_TIME_MS,
  })
}

/**
 * Reads the features the current user is granted
 *
 * @param enabled - Whether to ask at all, false wherever no screen would cover a page
 */
export function useFeatureGrants(enabled: boolean) {
  const { accessToken } = useAuth()
  return useQuery(featureGrantsQueryOptions(enabled && !!accessToken))
}

/**
 * Updates the current user's editable profile fields
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (_, payload) => {
      invalidateProfileUpdateCaches(queryClient, payload)
    },
  })
}

/**
 * Changes the current user's password
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: changePassword,
  })
}

/**
 * Downloads everything the current user owns, leaving every cache alone since the export only reads
 */
export function useDataExport({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  return useMutation({
    mutationFn: () => runWithMinimumPendingTime(minimumPendingMs, () => fetchDataExport()),
  })
}

/**
 * Asks for a confirmation email to a new account address, leaving every cache alone since the address
 * changes only when the emailed link is confirmed
 */
export function useRequestEmailChange() {
  return useMutation({
    mutationFn: requestEmailChange,
  })
}

/**
 * Reads account IDs selected for runway calculations
 */
export function useRunwayAccounts() {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: userKeys.runwayAccounts(),
    queryFn: ({ signal }) => fetchRunwayAccounts(signal),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Updates selected runway accounts and refreshes runway results
 */
export function useUpdateRunwayAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateRunwayAccounts,
    onSuccess: (data) => {
      updateRunwayAccountCaches(queryClient, data)
    },
  })
}

/**
 * Reads runway settings with normalized threshold fields
 */
export function useRunwaySettings() {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: userKeys.runwaySettings(),
    queryFn: ({ signal }) => fetchRunwaySettings(signal),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Updates runway settings and refreshes dependent runway caches
 */
export function useUpdateRunwaySettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateRunwaySettings,
    onSuccess: (data) => {
      updateRunwaySettingsCaches(queryClient, data)
    },
  })
}

/**
 * Reads runway results with normalized threshold fields
 */
export function useRunway() {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: userKeys.runway(),
    queryFn: ({ signal }) => fetchRunway(signal),
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(RUNWAY_FX_STALE_TIME_MS),
  })
}
