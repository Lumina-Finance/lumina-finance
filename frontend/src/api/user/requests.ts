import type { User } from '@/api/auth/types';
import { authenticatedFetch } from '@/api/client';
import {
  fromRunwayResultResponse,
  fromRunwaySettingsResponse,
  toRunwaySettingsPayload,
} from '@/api/user/mappers';
import type {
  CacheStatus,
  ChangePasswordPayload,
  RunwayResultResponse,
  RunwaySettingsResponse,
  RunwaySettingsUpdate,
  UpdateProfilePayload,
} from '@/api/user/types';

/**
 * Fetches cache freshness metadata for the current user's visible data
 */
export function fetchCacheStatus() {
  return authenticatedFetch<CacheStatus>('/me/cache-status');
}

/**
 * Updates editable current-user profile fields
 */
export function updateProfile(payload: UpdateProfilePayload) {
  return authenticatedFetch<User>('/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Changes the current user's password and signs out their other sessions
 */
export function changePassword(payload: ChangePasswordPayload) {
  return authenticatedFetch<void>('/auth/password', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}


/**
 * Sets the first password for an account authorized by a provider reauth, then signs out other sessions
 */
export function setPassword(payload: { new_password: string }) {
  return authenticatedFetch<void>('/auth/password/set', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetches account IDs selected for runway calculations
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchRunwayAccounts(signal?: AbortSignal) {
  return authenticatedFetch<string[]>('/me/runway-accounts', { signal });
}

/**
 * Updates the accounts selected for runway calculations
 */
export function updateRunwayAccounts(accountIds: string[]) {
  return authenticatedFetch<string[]>('/me/runway-accounts', {
    method: 'PUT',
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

/**
 * Fetches runway settings and normalizes backend threshold fields
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export async function fetchRunwaySettings(signal?: AbortSignal) {
  return fromRunwaySettingsResponse(
    await authenticatedFetch<RunwaySettingsResponse>('/me/runway-settings', { signal }),
  );
}

/**
 * Updates runway settings after converting frontend threshold fields for the backend
 */
export async function updateRunwaySettings(settings: RunwaySettingsUpdate) {
  return fromRunwaySettingsResponse(
    await authenticatedFetch<RunwaySettingsResponse>('/me/runway-settings', {
      method: 'PUT',
      body: JSON.stringify(toRunwaySettingsPayload(settings)),
    }),
  );
}

/**
 * Fetches runway results and normalizes backend threshold fields
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export async function fetchRunway(signal?: AbortSignal) {
  return fromRunwayResultResponse(
    await authenticatedFetch<RunwayResultResponse>('/me/runway', { signal }),
  );
}
