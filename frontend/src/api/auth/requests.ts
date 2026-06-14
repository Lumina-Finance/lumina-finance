import { API_BASE } from '@/api/config';
import { ApiError, isRefreshAlreadyRotatedError } from '@/api/auth/errors';
import type { AuthResponse, LoginPayload, SignupPayload } from '@/api/auth/types';

const REFRESH_ROTATION_RETRY_DELAY_MS = 100;
const REFRESH_ROTATION_RETRY_TIMEOUT_MS = 5_000;
const REFRESH_REQUEST_LOCK_MS = 3_000;
const REFRESH_REQUEST_LOCK_KEY = 'lumina:refresh_request_lock_until';

/**
 * Resolves after the requested delay
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Waits briefly so a winning refresh response can apply its Set-Cookie header
 */
function waitForRefreshRotationCookie(): Promise<void> {
  return wait(REFRESH_ROTATION_RETRY_DELAY_MS);
}

/**
 * Returns browser storage when it can be used for reload coordination
 */
function getRefreshRequestStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Returns how long this page should wait for a refresh started by a previous page
 */
function getRefreshRequestLockRemainingMs(storage: Storage): number {
  const lockedUntil = Number(storage.getItem(REFRESH_REQUEST_LOCK_KEY));
  if (!Number.isFinite(lockedUntil)) {
    storage.removeItem(REFRESH_REQUEST_LOCK_KEY);
    return 0;
  }

  const remainingMs = lockedUntil - Date.now();
  if (remainingMs <= 0) {
    storage.removeItem(REFRESH_REQUEST_LOCK_KEY);
    return 0;
  }

  return remainingMs;
}

/**
 * Waits for an in-flight refresh from a previous page load to finish applying cookies
 */
async function waitForPriorRefreshRequest(): Promise<void> {
  const storage = getRefreshRequestStorage();
  if (!storage) return;

  const remainingMs = getRefreshRequestLockRemainingMs(storage);
  if (remainingMs > 0) {
    await wait(remainingMs);
  }
}

/**
 * Stores a short-lived refresh lock that survives page reloads
 */
function setRefreshRequestLock(): string | null {
  const storage = getRefreshRequestStorage();
  if (!storage) return null;

  const lockValue = String(Date.now() + REFRESH_REQUEST_LOCK_MS);
  storage.setItem(REFRESH_REQUEST_LOCK_KEY, lockValue);
  return lockValue;
}

/**
 * Clears this page's refresh lock without removing a newer page's lock
 */
function clearRefreshRequestLock(lockValue: string | null): void {
  if (!lockValue) return;

  const storage = getRefreshRequestStorage();
  if (storage?.getItem(REFRESH_REQUEST_LOCK_KEY) === lockValue) {
    storage.removeItem(REFRESH_REQUEST_LOCK_KEY);
  }
}

/**
 * Sends auth requests with the refresh cookie and normalizes backend error responses
 */
async function requestAuth<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,

    // Auth endpoints need the httpOnly refresh cookie for session rotation
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.detail ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return res.json();
}

/**
 * Authenticates a user with email and password credentials
 */
export function login(payload: LoginPayload): Promise<AuthResponse> {
  return requestAuth('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Creates a user and starts an authenticated session
 */
export function signup(payload: SignupPayload): Promise<AuthResponse> {
  return requestAuth('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Refreshes the access token using the httpOnly refresh cookie
 *
 * Retries when the backend reports that another request already rotated the
 * refresh token, because the browser may have a newer cookie from that response
 */
export async function refresh(): Promise<AuthResponse> {
  await waitForPriorRefreshRequest();
  const lockValue = setRefreshRequestLock();
  const startedAt = Date.now();

  try {
    while (true) {
      try {
        return await requestAuth('/auth/refresh', { method: 'POST' });
      } catch (error) {
        if (!isRefreshAlreadyRotatedError(error)) throw error;
        if (Date.now() - startedAt >= REFRESH_ROTATION_RETRY_TIMEOUT_MS) throw error;

        await waitForRefreshRotationCookie();
      }
    }
  } finally {
    clearRefreshRequestLock(lockValue);
  }
}

/**
 * Ends the current session and revokes the active access token
 */
export function logout(accessToken: string): Promise<void> {
  return requestAuth('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
