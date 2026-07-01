/**
 * Covers authenticated fetch session handling around refresh-token rotation races
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AuthResponse } from '@/api/auth';
import { API_BASE } from '@/api/config';
import { authenticatedFetch, registerAuthBindings } from '@/api/client';

const refreshedAuthResponse: AuthResponse = {
  user: {
    id: 'user_123',
    email: 'daniel@example.com',
    first_name: 'Daniel',
    last_name: null,
    tz: 'America/Toronto',
    base_currency: 'CAD',
    created_at: '2026-06-12T00:00:00Z',
  },
  access_token: 'new-access-token',
  token_type: 'bearer',
};

const fetchMock = vi.fn();
const onSessionRefreshed = vi.fn();
const onSessionLost = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onSessionRefreshed.mockReset();
  onSessionLost.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  registerAuthBindings({
    getAccessToken: () => 'old-access-token',
    onSessionRefreshed,
    onSessionLost,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('authenticatedFetch', () => {
  it('does not mark the session lost when refresh reports a rotation race', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'WWW-Authenticate': 'Bearer' }),
        json: async () => ({ detail: 'Token is not active' }),
      })

      // Every refresh attempt keeps reporting the rotation conflict so the retry
      // budget is exhausted and the conflict is surfaced rather than a lost session
      .mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: 'Refresh token was already rotated' }),
      });

    const request = authenticatedFetch('/accounts').catch((error: unknown) => error);

    // Advance past the full rotation retry budget so the loop gives up
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await request;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'Refresh token was already rotated',
      status: 409,
    });
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(onSessionRefreshed).not.toHaveBeenCalled();
  });

  it('updates auth state and retries the original request after refresh succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'WWW-Authenticate': 'Bearer' }),
        json: async () => ({ detail: 'Token is not active' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => refreshedAuthResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accounts: [] }),
      });

    await expect(authenticatedFetch('/accounts')).resolves.toEqual({ accounts: [] });
    expect(onSessionRefreshed).toHaveBeenCalledWith(refreshedAuthResponse);
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/accounts`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer new-access-token',
      },
    });
  });

  it('does not refresh or resend a wrong-credential 401 that lacks the bearer challenge', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ detail: 'Invalid two-factor code' }),
    });

    const error = await authenticatedFetch('/auth/2fa/disable', { method: 'POST' }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Invalid two-factor code', status: 401 });

    // The request is sent once and never resent, so the failed attempt counts a single time
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSessionRefreshed).not.toHaveBeenCalled();
    expect(onSessionLost).not.toHaveBeenCalled();
  });
});
