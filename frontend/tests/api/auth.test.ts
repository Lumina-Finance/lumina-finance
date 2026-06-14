/**
 * Covers auth API request functions that manage login, signup, refresh, and logout
 *
 * These tests catch regressions where auth endpoints lose cookie credentials,
 * JSON headers, bearer logout headers, or backend error details
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const REFRESH_REQUEST_LOCK_KEY = 'lumina:refresh_request_lock_until';

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  } as Storage;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => authResponse,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it('waits for a previous page-load refresh lock before refreshing', async () => {
    vi.useFakeTimers();
    const storage = createStorageMock();
    vi.stubGlobal('window', { localStorage: storage });
    storage.setItem(REFRESH_REQUEST_LOCK_KEY, String(Date.now() + 3_000));

    const request = refresh();

    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(request).resolves.toEqual(authResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  it('retries refresh when a stale request loses a rotation race', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ detail: 'Refresh token was already rotated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => authResponse,
      });

    const request = refresh();

    await vi.advanceTimersByTimeAsync(100);

    await expect(request).resolves.toEqual(authResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/auth/refresh`, {
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
