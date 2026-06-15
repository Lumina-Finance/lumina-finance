import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  invalidateProfileUpdateCaches,
  updateRunwayAccountCaches,
  updateRunwaySettingsCaches,
} from '@/api/cache/updates/user';
import {
  fetchRunway,
  fetchRunwayAccounts,
  fetchRunwaySettings,
  updateProfile,
  updateRunwayAccounts,
  updateRunwaySettings,
} from '@/api/user/requests';
import { userKeys } from '@/api/cache/queryKeys';
import { getFxAwareStaleTime } from '@/api/shared/fxCache';
import { useAuth } from '@/hooks/useAuth';

const RUNWAY_FX_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * Updates the current user's editable profile fields
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (_, payload) => {
      invalidateProfileUpdateCaches(queryClient, payload);
    },
  });
}

/**
 * Reads account IDs selected for runway calculations
 */
export function useRunwayAccounts() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runwayAccounts(),
    queryFn: fetchRunwayAccounts,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Updates selected runway accounts and refreshes runway results
 */
export function useUpdateRunwayAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateRunwayAccounts,
    onSuccess: (data) => {
      updateRunwayAccountCaches(queryClient, data);
    },
  });
}

/**
 * Reads runway settings with normalized threshold fields
 */
export function useRunwaySettings() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runwaySettings(),
    queryFn: fetchRunwaySettings,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Updates runway settings and refreshes dependent runway caches
 */
export function useUpdateRunwaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateRunwaySettings,
    onSuccess: (data) => {
      updateRunwaySettingsCaches(queryClient, data);
    },
  });
}

/**
 * Reads runway results with normalized threshold fields
 */
export function useRunway() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runway(),
    queryFn: fetchRunway,
    enabled: !!accessToken,
    staleTime: getFxAwareStaleTime(RUNWAY_FX_STALE_TIME_MS),
  });
}
