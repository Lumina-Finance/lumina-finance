import { useMutation } from '@tanstack/react-query';
import { confirmTotp, setupTotp } from '@/api/twoFactor/requests';

/**
 * Begins TOTP enrolment for the current user
 */
export function useSetupTotp() {
  return useMutation({ mutationFn: setupTotp });
}

/**
 * Confirms TOTP enrolment and returns the recovery codes to show once
 */
export function useConfirmTotp() {
  return useMutation({ mutationFn: confirmTotp });
}
