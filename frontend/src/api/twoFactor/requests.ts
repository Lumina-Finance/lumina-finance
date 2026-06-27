import { authenticatedFetch } from '@/api/client';
import type {
  ConfirmTotpPayload,
  RecoveryCodesResponse,
  StepUpPayload,
  TotpSetupResponse,
  TotpStatusResponse,
} from '@/api/twoFactor/types';

/**
 * Reports whether the current user has two-factor authentication enabled
 */
export function fetchTotpStatus() {
  return authenticatedFetch<TotpStatusResponse>('/auth/2fa/status');
}

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

/**
 * Turns two-factor on after the user acknowledges their recovery codes
 */
export function completeTotp() {
  return authenticatedFetch<void>('/auth/2fa/complete', { method: 'POST' });
}

/**
 * Disables two-factor authentication after a step-up reauthentication
 */
export function disableTotp(payload: StepUpPayload) {
  return authenticatedFetch<void>('/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Replaces the recovery codes after a step-up reauthentication
 */
export function regenerateRecoveryCodes(payload: StepUpPayload) {
  return authenticatedFetch<RecoveryCodesResponse>('/auth/2fa/recovery-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
