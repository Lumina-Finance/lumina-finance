import { authenticatedFetch } from '@/api/client';
import type {
  ConfirmTotpPayload,
  RecoveryCodesResponse,
  StepUpPayload,
  TotpSetupResponse,
  TotpStatusResponse,
} from '@/api/two-factor/types';

/**
 * Reports whether the current user has two-factor authentication enabled
 */
export function fetchTotpStatus() {
  return authenticatedFetch<TotpStatusResponse>('/auth/2fa/status');
}

/**
 * Begins TOTP enrolment, returning the secret and provisioning URI for the authenticator app
 */
export function setupTotp(stepUp?: StepUpPayload) {
  // The step-up is checked here, before the secret is minted, so a wrong factor is refused before the QR
  // is shown. A forced re-enrol sends none, which the backend allows
  return authenticatedFetch<TotpSetupResponse>('/auth/2fa/setup', {
    method: 'POST',
    body: JSON.stringify({ step_up: stepUp }),
  });
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
 * Stages a fresh recovery code batch after a step-up reauthentication, leaving the active codes live
 */
export function regenerateRecoveryCodes(payload: StepUpPayload) {
  return authenticatedFetch<RecoveryCodesResponse>('/auth/2fa/recovery-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Activates the staged recovery code batch once the user acknowledges it
 */
export function confirmRecoveryCodes() {
  return authenticatedFetch<void>('/auth/2fa/recovery-codes/confirm', { method: 'POST' });
}
