import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { twoFactorKeys } from '@/api/cache/queryKeys';
import {
  completeTotp,
  confirmRecoveryCodes,
  confirmTotp,
  disableTotp,
  fetchTotpStatus,
  regenerateRecoveryCodes,
  setupTotp,
} from '@/api/twoFactor/requests';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads whether the current user has two-factor authentication enabled
 */
export function useTotpStatus() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: twoFactorKeys.status(),
    queryFn: fetchTotpStatus,
    enabled: !!accessToken,
  });
}

/**
 * Begins TOTP enrolment by minting a pending secret for the current user
 *
 * Modelled as a query rather than a mutation so React Query dedupes the request the StrictMode
 * double-mount would otherwise duplicate, and so the data reliably reaches the rendered component.
 * gcTime and staleTime of zero mint a fresh secret each time the enrolment view opens
 */
export function useSetupTotp() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: twoFactorKeys.setup(),
    queryFn: setupTotp,
    enabled: !!accessToken,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Confirms the enrolment code and returns recovery codes, leaving two-factor pending until completion
 */
export function useConfirmTotp() {
  return useMutation({ mutationFn: confirmTotp });
}

/**
 * Completes enrolment so two-factor turns on, then refreshes the enabled status
 */
export function useCompleteTotp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completeTotp,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: twoFactorKeys.status() }),
  });
}

/**
 * Disables two-factor authentication and refreshes the enabled status
 */
export function useDisableTotp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disableTotp,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: twoFactorKeys.status() }),
  });
}

/**
 * Stages a fresh recovery code batch for the current user
 */
export function useRegenerateRecoveryCodes() {
  return useMutation({ mutationFn: regenerateRecoveryCodes });
}

/**
 * Activates the staged recovery code batch once the user acknowledges it
 */
export function useConfirmRecoveryCodes() {
  return useMutation({ mutationFn: confirmRecoveryCodes });
}
