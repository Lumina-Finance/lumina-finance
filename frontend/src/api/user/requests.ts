import type { User } from '@/api/auth/types'
import { authenticatedFetch, authenticatedRequest } from '@/api/client'
import { EXPORT_TIMEOUT_MS } from '@/api/shared/exportTimeout'
import type { StepUpPayload } from '@/api/two-factor/types'
import { fromRunwayResultResponse, fromRunwaySettingsResponse, toRunwaySettingsPayload } from '@/api/user/mappers'
import type {
  CacheStatus,
  ChangePasswordPayload,
  FeatureGrants,
  ProfileDeletionResult,
  RatesStatus,
  RequestEmailChangePayload,
  RunwayResultResponse,
  RunwaySettingsResponse,
  RunwaySettingsUpdate,
  UpdateProfilePayload,
  UserProfile,
} from '@/api/user/types'

/**
 * Fetches cache freshness metadata for the current user's visible data
 */
export function fetchCacheStatus() {
  return authenticatedFetch<CacheStatus>('/me/cache-status')
}

/**
 * Fetches a digest of the recent exchange rates behind the current user's converted figures
 */
export function fetchRatesStatus() {
  return authenticatedFetch<RatesStatus>('/me/rates-status')
}

/**
 * Fetches the features the current user is granted
 */
export function fetchFeatureGrants(signal?: AbortSignal) {
  return authenticatedFetch<FeatureGrants>('/me/feature-grants', { signal })
}

/**
 * Fetches the current user's profile
 */
export function fetchProfile() {
  return authenticatedFetch<User>('/me')
}

/**
 * Fetches the current user's profile with the sentence the server gives when it refuses other currencies
 *
 * @param signal - Aborts the request when the read that asked for it is abandoned
 */
export function fetchUserProfile(signal?: AbortSignal) {
  return authenticatedFetch<UserProfile>('/me', { signal })
}

/**
 * Updates editable current-user profile fields
 */
export function updateProfile(payload: UpdateProfilePayload) {
  return authenticatedFetch<User>('/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/**
 * Downloads everything the current user owns as a ZIP of CSV files
 *
 * @param signal - Aborts the request when the export that asked for it is abandoned
 */
export async function fetchDataExport(signal?: AbortSignal) {
  const response = await authenticatedRequest('/me/export', {
    signal,
    timeoutMs: EXPORT_TIMEOUT_MS,
    headers: { Accept: 'application/zip' },
  })
  return response.blob()
}

/**
 * Changes the current user's password and signs out their other sessions
 */
export function changePassword(payload: ChangePasswordPayload) {
  return authenticatedFetch<void>('/auth/password', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/**
 * Sets the first password for an account authorized by a provider reauth, then signs out other sessions
 */
export function setPassword(payload: { new_password: string }) {
  return authenticatedFetch<void>('/auth/password/set', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Signs the account out of every other device after step-up
 *
 * An account with a password passes its step-up. A passwordless account omits it and relies on the
 * reauth proof cookie a fresh provider reauth armed, so the null body carries no step-up
 */
export function endOtherSessions(stepUp?: StepUpPayload) {
  return authenticatedFetch<void>('/auth/sessions/end-others', {
    method: 'POST',
    body: JSON.stringify(stepUp ?? null),
  })
}

/**
 * Deletes the profile and everything it holds, and signs it out everywhere
 *
 * An account with a password passes its step-up, and a passwordless one omits it, relying on the
 * reauth proof cookie. The data goes once the server has answered, or on the due time the answer names,
 * so the app signs out straight after
 */
export function deleteProfile(stepUp?: StepUpPayload) {
  return authenticatedFetch<ProfileDeletionResult>('/auth/profile/delete', {
    method: 'POST',
    body: JSON.stringify(stepUp ?? null),
  })
}

/**
 * Cancels a deletion that is waiting to run, answering with the user it hands back to the app
 *
 * The server answers 409 once the due time has passed
 */
export function cancelProfileDeletion() {
  return authenticatedFetch<User>('/auth/profile/delete/cancel', { method: 'POST' })
}

/**
 * Asks for a confirmation email to a new address for the account
 *
 * The answer is the same whether or not another account uses the address, and the account's address
 * changes only when the emailed link is confirmed. An account with a password passes its step-up, and a
 * passwordless one omits it, relying on the reauth proof cookie
 */
export function requestEmailChange(payload: RequestEmailChangePayload) {
  return authenticatedFetch<void>('/auth/email/change', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Fetches account IDs selected for runway calculations
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchRunwayAccounts(signal?: AbortSignal) {
  return authenticatedFetch<string[]>('/me/runway-accounts', { signal })
}

/**
 * Updates the accounts selected for runway calculations
 */
export function updateRunwayAccounts(accountIds: string[]) {
  return authenticatedFetch<string[]>('/me/runway-accounts', {
    method: 'PUT',
    body: JSON.stringify({ account_ids: accountIds }),
  })
}

/**
 * Fetches runway settings and normalizes backend threshold fields
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export async function fetchRunwaySettings(signal?: AbortSignal) {
  return fromRunwaySettingsResponse(await authenticatedFetch<RunwaySettingsResponse>('/me/runway-settings', { signal }))
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
  )
}

/**
 * Fetches runway results and normalizes backend threshold fields
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export async function fetchRunway(signal?: AbortSignal) {
  return fromRunwayResultResponse(await authenticatedFetch<RunwayResultResponse>('/me/runway', { signal }))
}
