import * as authApi from './auth';
import { ApiError, type AuthResponse } from './auth';
import { API_BASE } from './config';

interface AuthBindings {
  getAccessToken: () => string | null;
  onSessionRefreshed: (response: AuthResponse) => void;
  onSessionLost: () => void;
}

let bindings: AuthBindings | null = null;
export const LOCAL_CACHE_CHANGE_EVENT = 'lumina:local-cache-change';

// Called once by AuthProvider on mount so authenticatedFetch can read the
// current token and push refreshed sessions back into React state.
export function registerAuthBindings(b: AuthBindings): void {
  bindings = b;
}

// Shared in-flight refresh so parallel 401s only trigger one /auth/refresh.
let pendingRefresh: Promise<AuthResponse> | null = null;

function refreshOnce(): Promise<AuthResponse> {
  if (!pendingRefresh) {
    pendingRefresh = authApi.refresh().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

function isMutatingRequest(options: RequestInit): boolean {
  const method = (options.method ?? 'GET').toUpperCase();
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

// Drop-in fetch for endpoints that require a Bearer token. On 401 it refreshes
// the access token once and retries the original request before giving up.
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

  if (res.status === 401) {
    try {
      const refreshed = await refreshOnce();
      bindings.onSessionRefreshed(refreshed);
      res = await makeRequest(refreshed.access_token);
    } catch {
      bindings.onSessionLost();
      throw new ApiError('Session expired', 401);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    const message = body?.detail ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  if (isMutatingRequest(options)) {
    window.dispatchEvent(new Event(LOCAL_CACHE_CHANGE_EVENT));
  }

  // 204 No Content responses have an empty body, so calling res.json() would cause an error.
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
