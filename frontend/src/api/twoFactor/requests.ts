import { authenticatedFetch } from '@/api/client';
import type { ConfirmTotpPayload, RecoveryCodesResponse, TotpSetupResponse } from '@/api/twoFactor/types';

/**
 * Begins TOTP enrolment, returning the secret and provisioning URI for the authenticator app
 */
export function setupTotp() {
  return authenticatedFetch<TotpSetupResponse>('/auth/2fa/setup', { method: 'POST' });
}

/**
 * Confirms TOTP enrolment with an authenticator code, returning the one-time recovery codes
 */
export function confirmTotp(payload: ConfirmTotpPayload) {
  return authenticatedFetch<RecoveryCodesResponse>('/auth/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
