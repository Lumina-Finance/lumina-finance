import { ApiError } from '@/api/auth/errors';
import type { AuthResponse } from '@/api/auth/types';
import { API_BASE } from '@/api/config';
import { OIDC_EMAIL_CONFLICT_CODE, OidcEmailConflictError } from '@/api/oidc/errors';
import type {
  OidcAuthorizeResponse,
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
