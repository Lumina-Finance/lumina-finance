import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import type { User } from '@/api/auth';
import { authenticatedFetch } from '@/api/client';
import { userKeys } from '@/api/queryKeys';

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
      // The runway figure depends on the selected accounts; invalidate so the
      // widget reflects the new selection without a manual refresh.
      queryClient.invalidateQueries({ queryKey: userKeys.runway(), exact: true });
    },
  });
}

// Mirrors backend RunwayResponse. `months` is null when `reason` is set —
// either the user hasn't chosen accounts or there's not enough expense data.
export interface RunwayResult {
  months: number | null;
  reason: 'no_accounts' | 'insufficient_history' | null;
  avg_monthly_expense: number;
  months_covered: number;
  liquid_balance: number;
}

export function useRunway() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: userKeys.runway(),
    queryFn: () => authenticatedFetch<RunwayResult>('/me/runway'),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}
