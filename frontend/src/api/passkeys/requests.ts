import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
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
