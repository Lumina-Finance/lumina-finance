import { API_BASE } from '@/api/config';
import { ApiError, isRefreshAlreadyRotatedError } from '@/api/auth/errors';
import type { AuthResponse, LoginPayload, SignupPayload } from '@/api/auth/types';

const REFRESH_ROTATION_RETRY_DELAY_MS = 100;

/**
 * Waits briefly so a winning refresh response can apply its Set-Cookie header
 */
function waitForRefreshRotationCookie(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, REFRESH_ROTATION_RETRY_DELAY_MS);
  });
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
 * Retries once when the backend reports that another request already rotated
 * the refresh token, because the browser may have a newer cookie from that
 * winning response
 */
export async function refresh(): Promise<AuthResponse> {
  try {
    return await requestAuth('/auth/refresh', { method: 'POST' });
  } catch (error) {
    if (!isRefreshAlreadyRotatedError(error)) throw error;

    await waitForRefreshRotationCookie();
    return requestAuth('/auth/refresh', { method: 'POST' });
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
