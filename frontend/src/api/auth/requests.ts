import { API_BASE } from '@/api/config';
import { ApiError } from '@/api/auth/errors';
import type { AuthResponse, LoginPayload, SignupPayload } from '@/api/auth/types';

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
 */
export function refresh(): Promise<AuthResponse> {
  return requestAuth('/auth/refresh', { method: 'POST' });
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
