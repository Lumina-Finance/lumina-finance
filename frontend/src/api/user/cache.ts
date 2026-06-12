import type { QueryClient } from '@tanstack/react-query';
import { invalidateAggregateData } from '@/api/cacheInvalidation';
import { userKeys } from '@/api/queryKeys';
import type {
  RunwayResult,
  RunwaySettings,
  UpdateProfilePayload,
} from '@/api/user/types';

/**
 * Invalidates aggregate data when profile timezone changes alter date-bucketed rollups
 */
export function invalidateProfileUpdateCaches(
  queryClient: QueryClient,
  payload: UpdateProfilePayload,
) {
  if ('tz' in payload) invalidateAggregateData(queryClient);
}

/**
 * Updates runway account caches after the selected account list changes
 */
export function updateRunwayAccountCaches(queryClient: QueryClient, accountIds: string[]) {
  queryClient.setQueryData(userKeys.runwayAccounts(), accountIds);
  queryClient.setQueryData<RunwaySettings | undefined>(
    userKeys.runwaySettings(),
    (current) => current ? { ...current, accountIds } : current,
  );
  queryClient.invalidateQueries({ queryKey: userKeys.runway(), exact: true });
}

/**
 * Updates runway settings caches after thresholds or selected accounts change
 */
export function updateRunwaySettingsCaches(queryClient: QueryClient, settings: RunwaySettings) {
  queryClient.setQueryData(userKeys.runwaySettings(), settings);
  queryClient.setQueryData(userKeys.runwayAccounts(), settings.accountIds);
  queryClient.setQueryData<RunwayResult | undefined>(
    userKeys.runway(),
    (current) => current ? { ...current, thresholds: settings.thresholds } : current,
  );
  queryClient.invalidateQueries({ queryKey: userKeys.runway(), exact: true });
}
