import { startAuthentication } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { ApiError } from '@/api/auth/errors';
import type { AuthResponse } from '@/api/auth/types';
import { authenticatedFetch } from '@/api/client';
import { API_BASE } from '@/api/config';
import type { Passkey, PasskeyConfig, RegisterPasskeyPayload, RegisterPasskeyResult } from '@/api/passkeys/types';
import type { StepUpPayload } from '@/api/two-factor/types';

/**
 * Reads the relying party id from the public config endpoint
 *
 * Plain fetch rather than the authenticated client because the login screen reads this before any
 * user exists
 */
export async function fetchPasskeyConfig(): Promise<PasskeyConfig> {
  const response = await fetch(`${API_BASE}/auth/passkeys/config`);
  if (!response.ok) {
    throw new Error(`Failed to load passkey config (${response.status})`);
  }
  return response.json();
}

/**
 * Begins a passwordless sign-in, returning the ceremony options for the browser
 *
 * Plain fetch with the credentials flag rather than the authenticated client because no user is signed
 * in yet, and the verify step needs to set the refresh cookie
 */
export async function fetchPasskeyAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const response = await fetch(`${API_BASE}/auth/passkeys/authenticate/options`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(`Failed to start passkey sign-in (${response.status})`, response.status);
  }
  return response.json();
}

/**
 * Verifies a sign-in assertion and resolves to the new session tokens
 */
export async function authenticatePasskey(credential: AuthenticationResponseJSON): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/passkeys/authenticate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(
      body?.detail ?? `Passkey sign-in failed (${response.status})`,
      response.status,
      { detail: body?.detail },
    );
  }
  return response.json();
}

/**
 * Lists the current user's registered passkeys, newest first
 */
export function fetchPasskeys() {
  return authenticatedFetch<Passkey[]>('/auth/passkeys');
}

/**
 * Begins registration, returning the ceremony options the browser passes to the authenticator
 */
export function fetchPasskeyRegistrationOptions(stepUp?: StepUpPayload) {
  // The step-up is checked here, before the ceremony, so a wrong factor is refused before any passkey
  // is created. A forced re-enrol sends none, which the backend allows
  return authenticatedFetch<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/register/options', {
    method: 'POST',
    body: JSON.stringify({ step_up: stepUp }),
  });
}

/**
 * Begins the passkey second-factor step for a login that passed its password
 */
export async function fetchPasskeyMfaOptions(mfaToken: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const response = await fetch(`${API_BASE}/auth/passkeys/mfa/options`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfa_token: mfaToken }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(
      body?.detail ?? `Failed to start passkey verification (${response.status})`,
      response.status,
      { detail: body?.detail },
    );
  }
  return response.json();
}

/**
 * Verifies a passkey assertion as the second factor of a password login
 */
export async function verifyPasskeyMfa(
  mfaToken: string,
  credential: AuthenticationResponseJSON,
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/passkeys/mfa/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfa_token: mfaToken, credential }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(
      body?.detail ?? `Passkey verification failed (${response.status})`,
      response.status,
      { detail: body?.detail },
    );
  }
  return response.json();
}

/**
 * Begins the passkey second-factor step for a password reset holding a valid emailed token
 */
export async function fetchPasskeyResetOptions(mfaToken: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const response = await fetch(`${API_BASE}/auth/passkeys/reset/options`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfa_token: mfaToken }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(
      body?.detail ?? `Failed to start passkey verification (${response.status})`,
      response.status,
      { detail: body?.detail },
    );
  }
  return response.json();
}

/**
 * Verifies a passkey assertion as the second factor of a password reset
 */
export async function verifyPasskeyReset(
  payload: { token: string; new_password: string; mfa_token: string },
  credential: AuthenticationResponseJSON,
): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/passkeys/reset/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, credential }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(
      body?.detail ?? `Passkey verification failed (${response.status})`,
      response.status,
      { detail: body?.detail },
    );
  }
}

/**
 * Begins a passkey step-up for a sensitive two-factor change, returning the ceremony options
 *
 * Authenticated because the caller already holds a session, unlike the login ceremonies
 */
export function fetchPasskeyStepUpOptions() {
  return authenticatedFetch<PublicKeyCredentialRequestOptionsJSON>('/auth/passkeys/step-up/options', {
    method: 'POST',
  });
}

/**
 * Runs the passkey step-up ceremony, resolving to the assertion the action endpoint then verifies
 *
 * The browser prompt sits between the options and the action request so the assertion answers a
 * challenge this server issued
 */
export async function requestPasskeyStepUpAssertion(): Promise<AuthenticationResponseJSON> {
  const optionsJSON = await fetchPasskeyStepUpOptions();
  return startAuthentication({ optionsJSON });
}

/**
 * Verifies a finished ceremony and stores the passkey under the given label
 *
 * A first passkey comes back staged with recovery codes to acknowledge, a later one is active with no
 * codes
 */
export function registerPasskey(payload: RegisterPasskeyPayload) {
  return authenticatedFetch<RegisterPasskeyResult>('/auth/passkeys/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Activates a staged first passkey after its recovery codes have been saved
 */
export function confirmPasskeyRegistration() {
  return authenticatedFetch<void>('/auth/passkeys/register/confirm', { method: 'POST' });
}

/**
 * Relabels one of the current user's passkeys
 */
export function renamePasskey(passkeyId: string, name: string) {
  return authenticatedFetch<Passkey>(`/auth/passkeys/${passkeyId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/**
 * Deletes one of the current user's passkeys after step-up reauthentication
 */
export function removePasskey(passkeyId: string, payload: StepUpPayload) {
  return authenticatedFetch<void>(`/auth/passkeys/${passkeyId}/remove`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
