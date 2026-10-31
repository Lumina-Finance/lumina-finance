import * as authApi from './auth'
import { ApiError, buildApiError, type AuthResponse } from './auth'
import { fetchFromServer, type ServerRequestInit } from './server'

// Step-up 401s report how many tries remain before the shared lockout signs the user out everywhere
const ATTEMPTS_REMAINING_HEADER = 'X-Auth-Attempts-Remaining'

interface AuthBindings {
  getAccessToken: () => string | null
  /** When the access token stops being accepted on this device's clock, or null when unknown */
  getAccessTokenExpiresAt: () => number | null
  /** Takes a renewed session, or returns false once it has signed the tab out instead of taking it */
  onSessionRefreshed: (response: AuthResponse) => boolean
  onSessionLost: () => void
}

let bindings: AuthBindings | null = null

/**
 * Registers auth callbacks used by authenticatedFetch outside React state
 */
export function registerAuthBindings(b: AuthBindings): void {
  bindings = b
}

// A token this close to expiring is renewed before a request rather than sent, so it cannot run out while
// the request is on its way
const EXPIRY_MARGIN_MS = 30_000

let pendingRefresh: Promise<AuthResponse | null> | null = null

/**
 * Shares one in-flight refresh request so parallel requests do not refresh twice, and applies the
 * renewed session once, even when every request waiting on it has been abandoned
 *
 * @returns The renewed session, or null when the tab refused it and signed out
 */
function refreshOnce(): Promise<AuthResponse | null> {
  if (!pendingRefresh) {
    pendingRefresh = authApi
      .refresh()
      .then((refreshed) => (bindings?.onSessionRefreshed(refreshed) === false ? null : refreshed))
      .finally(() => {
        pendingRefresh = null
      })
  }
  return pendingRefresh
}

/**
 * Renews the session, ending it when the server refuses the renewal
 *
 * @throws ApiError "Session expired" when the refresh credentials were refused or the tab refused
 *   the renewed session, or the refresh failure itself when it says nothing about the session, such
 *   as a server error
 */
async function renewSession(onSessionLost: () => void): Promise<AuthResponse> {
  let refreshed: AuthResponse | null
  try {
    refreshed = await refreshOnce()
  } catch (error) {
    // Only rejected refresh credentials end the session; temporary failures remain retryable
    if (error instanceof ApiError && error.status === 401) {
      onSessionLost()
      throw new ApiError('Session expired', 401)
    }
    throw error
  }

  // A session the tab refused is never used, so no request goes out for the person it belongs to
  if (refreshed === null) throw new ApiError('Session expired', 401)
  return refreshed
}

/**
 * Sends an authenticated request, renewing an aged-out token first and retrying once after a refused
 * one is refreshed, and returns the response once the server has accepted it
 *
 * @throws ApiError built from the server's answer when it refuses the request
 */
export async function authenticatedRequest(path: string, options: ServerRequestInit = {}): Promise<Response> {
  if (!bindings) {
    throw new Error('authenticatedRequest called before auth bindings were registered')
  }

  let token = bindings.getAccessToken()
  if (!token) {
    throw new ApiError('Not authenticated', 401)
  }

  // A tab left open past the token's lifetime renews first, so its requests are not each refused
  // and resent. Should the renewal fail for a while, the token it has may still be accepted
  const expiresAt = bindings.getAccessTokenExpiresAt()
  if (expiresAt !== null && Date.now() >= expiresAt - EXPIRY_MARGIN_MS) {
    try {
      token = (await renewSession(bindings.onSessionLost)).access_token
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error
    }
  }

  const makeRequest = (accessToken: string): Promise<Response> =>
    fetchFromServer(path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    })

  let res = await makeRequest(token)

  // Only an access-token failure carries the bearer challenge. A wrong-credential 401 from a route,
  // such as a bad step-up code, has no challenge and must not be resent, or its failed attempt would
  // be counted twice against the shared lockout
  const isExpiredTokenResponse = res.status === 401 && res.headers.get('WWW-Authenticate') !== null

  if (isExpiredTokenResponse) {
    const refreshed = await renewSession(bindings.onSessionLost)
    res = await makeRequest(refreshed.access_token)
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const attemptsHeader = res.headers.get(ATTEMPTS_REMAINING_HEADER)
    const attemptsRemaining = attemptsHeader !== null ? Number(attemptsHeader) : undefined
    throw buildApiError(res.status, body, {
      attemptsRemaining: Number.isNaN(attemptsRemaining) ? undefined : attemptsRemaining,
    })
  }

  return res
}

/**
 * Fetches authenticated API endpoints and reads their JSON answer
 */
export async function authenticatedFetch<T>(path: string, options: ServerRequestInit = {}): Promise<T> {
  const res = await authenticatedRequest(path, options)

  // 204 No Content responses have an empty body, so res.json would fail
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}
