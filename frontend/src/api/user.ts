import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import type { User } from '@/api/auth';
import { authenticatedFetch } from '@/api/client';
import type { FxStatus } from '@/api/dashboard';
import { userKeys } from '@/api/queryKeys';
import { normalizeRunwayThresholds, type RunwayThresholds } from '@/utils/runway';

// Fields a user may edit on their own profile. `email` and `base_currency`
// are intentionally omitted — email is the identity handle, and base_currency
// is immutable for now since changing it would require rewriting historical
// currency rollups.
export interface UpdateProfilePayload {
  first_name?: string;
  last_name?: string | null;
  tz?: string;
}

// PATCH /me — partial update, only provided fields change. Caller is expected
// to wire the returned User back into AuthContext via setUser so the rest of
// the app reflects the new profile immediately.
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) =>
      authenticatedFetch<User>('/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  });
}

// Accounts the user has picked to feed the runway calculation.
// The backend returns the raw UUID list.
export function useRunwayAccounts() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runwayAccounts(),
    queryFn: () => authenticatedFetch<string[]>('/me/runway-accounts'),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateRunwayAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountIds: string[]) =>
      authenticatedFetch<string[]>('/me/runway-accounts', {
        method: 'PUT',
        body: JSON.stringify({ account_ids: accountIds }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.runwayAccounts(), data);
      queryClient.setQueryData<RunwaySettings | undefined>(
        userKeys.runwaySettings(),
        (current) => current ? { ...current, accountIds: data } : current,
      );
      // The runway figure depends on the selected accounts; invalidate so the
      // widget reflects the new selection without a manual refresh.
      queryClient.invalidateQueries({ queryKey: userKeys.runway(), exact: true });
    },
  });
}

interface RunwayThresholdsResponse {
  risky_below_months: number;
  healthy_at_months: number;
}

interface RunwaySettingsResponse {
  account_ids: string[];
  thresholds: RunwayThresholdsResponse;
}

export interface RunwaySettings {
  accountIds: string[];
  thresholds: RunwayThresholds;
}

function fromRunwayThresholdsResponse(thresholds: RunwayThresholdsResponse): RunwayThresholds {
  return normalizeRunwayThresholds({
    riskyBelowMonths: thresholds.risky_below_months,
    healthyAtMonths: thresholds.healthy_at_months,
  });
}

function toRunwayThresholdsPayload(thresholds: RunwayThresholds): RunwayThresholdsResponse {
  const safeThresholds = normalizeRunwayThresholds(thresholds);
  return {
    risky_below_months: safeThresholds.riskyBelowMonths,
    healthy_at_months: safeThresholds.healthyAtMonths,
  };
}

function fromRunwaySettingsResponse(settings: RunwaySettingsResponse): RunwaySettings {
  return {
    accountIds: settings.account_ids,
    thresholds: fromRunwayThresholdsResponse(settings.thresholds),
  };
}

function toRunwaySettingsPayload(settings: RunwaySettings): RunwaySettingsResponse {
  return {
    account_ids: settings.accountIds,
    thresholds: toRunwayThresholdsPayload(settings.thresholds),
  };
}

export function useRunwaySettings() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runwaySettings(),
    queryFn: async () => fromRunwaySettingsResponse(
      await authenticatedFetch<RunwaySettingsResponse>('/me/runway-settings'),
    ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateRunwaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: RunwaySettings) => fromRunwaySettingsResponse(
      await authenticatedFetch<RunwaySettingsResponse>('/me/runway-settings', {
        method: 'PUT',
        body: JSON.stringify(toRunwaySettingsPayload(settings)),
      }),
    ),
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.runwaySettings(), data);
      queryClient.setQueryData(userKeys.runwayAccounts(), data.accountIds);
      queryClient.setQueryData<RunwayResult | undefined>(
        userKeys.runway(),
        (current) => current ? { ...current, thresholds: data.thresholds } : current,
      );
      queryClient.invalidateQueries({ queryKey: userKeys.runway(), exact: true });
    },
  });
}

interface RunwayResultResponse {
  months: number | null;
  reason: 'no_accounts' | 'insufficient_history' | null;
  avg_monthly_expense: number;
  months_covered: number;
  liquid_balance: number;
  account_balances: RunwayAccountBalance[];
  thresholds: RunwayThresholdsResponse;
  fx_status: FxStatus;
}

export interface RunwayAccountBalance {
  account_id: string;
  balance: number;
}

// Mirrors backend RunwayResponse. `months` is null when `reason` is set —
// either the user hasn't chosen accounts or there's not enough net expense data.
export interface RunwayResult {
  months: number | null;
  reason: 'no_accounts' | 'insufficient_history' | null;
  avg_monthly_expense: number;
  months_covered: number;
  liquid_balance: number;
  account_balances: RunwayAccountBalance[];
  thresholds: RunwayThresholds;
  fx_status: FxStatus;
}

function fromRunwayResultResponse(result: RunwayResultResponse): RunwayResult {
  return {
    ...result,
    thresholds: fromRunwayThresholdsResponse(result.thresholds),
  };
}

export function useRunway() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runway(),
    queryFn: async () => fromRunwayResultResponse(
      await authenticatedFetch<RunwayResultResponse>('/me/runway'),
    ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
