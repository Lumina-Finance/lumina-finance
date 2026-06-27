import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { twoFactorKeys } from '@/api/cache/queryKeys';
import {
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
 * Begins TOTP enrolment for the current user
 */
export function useSetupTotp() {
  return useMutation({ mutationFn: setupTotp });
}

/**
 * Confirms TOTP enrolment, returning recovery codes and refreshing the enabled status
 */
export function useConfirmTotp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmTotp,
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
 * Replaces the recovery codes for the current user
 */
export function useRegenerateRecoveryCodes() {
  return useMutation({ mutationFn: regenerateRecoveryCodes });
}
