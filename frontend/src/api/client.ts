import * as authApi from './auth';
import { ApiError, type AuthResponse } from './auth';
import { API_BASE } from './config';

interface AuthBindings {
  getAccessToken: () => string | null;
  onSessionRefreshed: (response: AuthResponse) => void;
  onSessionLost: () => void;
}

let bindings: AuthBindings | null = null;

/**
 * Registers auth callbacks used by authenticatedFetch outside React state
 */
export function registerAuthBindings(b: AuthBindings): void {
  bindings = b;
}

let pendingRefresh: Promise<AuthResponse> | null = null;

/**
 * Shares one in-flight refresh request so parallel 401 responses do not refresh twice
 */
function refreshOnce(): Promise<AuthResponse> {
  if (!pendingRefresh) {
    pendingRefresh = authApi.refresh().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

/**
 * Fetches authenticated API endpoints and retries once after refreshing expired tokens
 */
export async function authenticatedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!bindings) {
    throw new Error('authenticatedFetch called before auth bindings were registered');
  }

  const token = bindings.getAccessToken();
  if (!token) {
    throw new ApiError('Not authenticated', 401);
  }

  const makeRequest = (accessToken: string): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });

  let res = await makeRequest(token);

  // Only an access-token failure carries the bearer challenge. A wrong-credential 401 from a route,
  // such as a bad step-up code, has no challenge and must not be resent, or its failed attempt would
  // be counted twice against the shared lockout
  const isExpiredTokenResponse = res.status === 401 && res.headers.get('WWW-Authenticate') !== null;

  if (isExpiredTokenResponse) {
    try {
      const refreshed = await refreshOnce();
      bindings.onSessionRefreshed(refreshed);
      res = await makeRequest(refreshed.access_token);
    } catch (error) {
      if (authApi.isRefreshAlreadyRotatedError(error)) {
        throw error;
      }

      bindings.onSessionLost();
      throw new ApiError('Session expired', 401);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    const message = body?.detail ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  // 204 No Content responses have an empty body, so res.json would fail
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
