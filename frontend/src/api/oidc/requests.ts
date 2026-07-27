import { ApiError } from '@/api/auth/errors';
import type { AuthResponse } from '@/api/auth/types';
import { API_BASE } from '@/api/config';
import { OIDC_EMAIL_CONFLICT_CODE, OidcEmailConflictError } from '@/api/oidc/errors';
import { authenticatedFetch } from '@/api/client';
import type { StepUpPayload } from '@/api/two-factor/types';
import type {
  OidcAuthorizeResponse,
  OidcIdentitiesResponse,
  OidcLinkedIdentity,
  OidcCallbackPayload,
  OidcCallbackResult,
  OidcOnboardingResponse,
  OidcProvider,
  OidcProvidersResponse,
  OidcSignupPayload,
} from '@/api/oidc/types';

/**
 * Sends OIDC requests with plain fetch because every step runs before a user is signed in
 *
 * The credentials flag rides along so the callback and signup steps can set the refresh cookie
 */
async function requestOidc<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string | { code?: string; email?: string } }
      | null;
    const detail = body?.detail;

    // The email conflict is the one structured error, carrying the address for a prefilled
    // password sign-in, while every other failure stays a plain message
    if (typeof detail === 'object' && detail?.code === OIDC_EMAIL_CONFLICT_CODE && detail.email) {
      throw new OidcEmailConflictError(detail.email);
    }
    const message = typeof detail === 'string' ? detail : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

/**
 * Reads the enabled sign-in providers the login page can offer
 */
export async function fetchOidcProviders(): Promise<OidcProvider[]> {
  const response = await requestOidc<OidcProvidersResponse>('/auth/oidc/providers');
  return response.providers;
}

/**
 * Starts a provider sign-in and resolves to the provider URL the browser must visit
 */
export function beginOidcSignIn(slug: string): Promise<OidcAuthorizeResponse> {
  return requestOidc(`/auth/oidc/${slug}/authorize`, { method: 'POST' });
}

/**
 * Finishes a provider sign-in, resolving to tokens or the onboarding step for a new user
 */
export function completeOidcCallback(payload: OidcCallbackPayload): Promise<OidcCallbackResult> {
  return requestOidc('/auth/oidc/callback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Narrows a callback result to the onboarding case for a first-time sign-in
 */
export function isOidcOnboardingRequired(result: OidcCallbackResult): result is OidcOnboardingResponse {
  return 'onboarding_required' in result;
}

/**
 * Creates the account a first-time provider sign-in onboarded and resolves to its tokens
 */
export function completeOidcSignup(payload: OidcSignupPayload): Promise<AuthResponse> {
  return requestOidc('/auth/oidc/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Reads the account's linked providers and whether it has a password for step-up actions
 */
export function fetchOidcIdentities(): Promise<OidcIdentitiesResponse> {
  return authenticatedFetch('/auth/oidc/identities');
}

/**
 * Starts linking a provider after step-up, resolving to the provider URL to visit
 *
 * An account with a password passes its step-up. A passwordless account omits it and relies on the
 * reauth proof cookie a fresh provider reauth armed, so the null body carries no step-up
 */
export function beginOidcLink(slug: string, stepUp?: StepUpPayload): Promise<OidcAuthorizeResponse> {
  return authenticatedFetch(`/auth/oidc/${slug}/link`, {
    method: 'POST',
    body: JSON.stringify(stepUp ?? null),
  });
}

/**
 * Finishes linking a provider to the signed-in account
 */
export function completeOidcLinkCallback(payload: OidcCallbackPayload): Promise<OidcLinkedIdentity> {
  return authenticatedFetch('/auth/oidc/link/callback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Removes a linked provider after step-up
 *
 * An account with a password passes its step-up. A passwordless account omits it and relies on the
 * reauth proof cookie a fresh provider reauth armed, so the null body carries no step-up
 */
export function removeOidcIdentity(identityId: string, stepUp?: StepUpPayload): Promise<void> {
  return authenticatedFetch(`/auth/oidc/identities/${identityId}/remove`, {
    method: 'POST',
    body: JSON.stringify(stepUp ?? null),
  });
}

/**
 * Starts a provider reauth so a passwordless account can authorize setting its first password
 */
export function beginOidcReauth(slug: string): Promise<OidcAuthorizeResponse> {
  return authenticatedFetch('/auth/oidc/reauth', {
    method: 'POST',
    body: JSON.stringify({ slug }),
  });
}

/**
 * Finishes a provider reauth, arming the httpOnly set-password authorization cookie
 */
export function completeOidcReauthCallback(payload: OidcCallbackPayload): Promise<void> {
  return authenticatedFetch('/auth/oidc/reauth/callback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
