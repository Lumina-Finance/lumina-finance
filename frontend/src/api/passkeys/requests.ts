import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { ApiError } from '@/api/auth/errors';
import type { AuthResponse } from '@/api/auth/types';
import { authenticatedFetch } from '@/api/client';
import { API_BASE } from '@/api/config';
import type { Passkey, PasskeyConfig, RegisterPasskeyPayload } from '@/api/passkeys/types';

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
    throw new ApiError(body?.detail ?? `Passkey sign-in failed (${response.status})`, response.status);
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
export function fetchPasskeyRegistrationOptions() {
  return authenticatedFetch<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/register/options', {
    method: 'POST',
  });
}

/**
 * Verifies a finished ceremony and stores the passkey under the given label
 */
export function registerPasskey(payload: RegisterPasskeyPayload) {
  return authenticatedFetch<Passkey>('/auth/passkeys/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
 * Deletes one of the current user's passkeys
 */
export function removePasskey(passkeyId: string) {
  return authenticatedFetch<void>(`/auth/passkeys/${passkeyId}`, { method: 'DELETE' });
}
