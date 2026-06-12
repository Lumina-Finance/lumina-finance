/**
 * Covers auth API request functions that manage login, signup, refresh, and logout
 *
 * These tests catch regressions where auth endpoints lose cookie credentials,
 * JSON headers, bearer logout headers, or backend error details
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from '@/api/config';
import {
  ApiError,
  login,
  logout,
  refresh,
  signup,
} from '@/api/auth';
import type { AuthResponse } from '@/api/auth';

const authResponse: AuthResponse = {
  user: {
    id: 'user_123',
    email: 'daniel@example.com',
    first_name: 'Daniel',
    last_name: null,
    tz: 'America/Toronto',
    base_currency: 'CAD',
    created_at: '2026-06-12T00:00:00Z',
  },
  access_token: 'access-token',
  token_type: 'bearer',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => authResponse,
  });
});

describe('auth API functions', () => {
  it('logs in with cookie credentials and JSON headers', async () => {
    await expect(login({
      email: 'daniel@example.com',
      password: 'secret',
    })).resolves.toEqual(authResponse);

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        email: 'daniel@example.com',
        password: 'secret',
      }),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  it('signs up with profile and currency fields', async () => {
    await signup({
      email: 'daniel@example.com',
      password: 'secret',
      first_name: 'Daniel',
      tz: 'America/Toronto',
      base_currency: 'CAD',
    });

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/signup`, {
      method: 'POST',
      body: JSON.stringify({
        email: 'daniel@example.com',
        password: 'secret',
        first_name: 'Daniel',
        tz: 'America/Toronto',
        base_currency: 'CAD',
      }),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  it('refreshes the auth session with the refresh cookie', async () => {
    await refresh();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  it('logs out with the active access token', async () => {
    await logout('access-token');

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-token',
      },
      credentials: 'include',
    });
  });

  it('raises API errors with backend detail messages', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid credentials' }),
    });

    const request = login({
      email: 'daniel@example.com',
      password: 'wrong',
    });

    await expect(request).rejects.toMatchObject({
      message: 'Invalid credentials',
      status: 401,
    });
    await expect(request).rejects.toBeInstanceOf(ApiError);
  });
});
