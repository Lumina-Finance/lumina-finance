/**
 * Covers authenticated fetch session handling around token refresh and request failures
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
    second_factor_reenrollment_required: false,
  },
  access_token: 'new-access-token',
  token_type: 'bearer',
};

const fetchMock = vi.fn();
const onSessionRefreshed = vi.fn();
const onSessionLost = vi.fn();

/** Builds a real JSON response for the request chain */
function jsonResponse(status: number, body: unknown, bearer = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: bearer ? { 'WWW-Authenticate': 'Bearer' } : undefined,
  });
}

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
  it.each([
    ['network rejection', new TypeError('Network unavailable')],
    ['cancellation', new DOMException('Request cancelled', 'AbortError')],
  ])('keeps refreshed auth after retry %s', async (_label, failure) => {
    const controller = new AbortController();
    const options: RequestInit = { method: 'PATCH', body: '{"name":"Updated"}', signal: controller.signal };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(200, refreshedAuthResponse))
      .mockRejectedValueOnce(failure);

    await expect(authenticatedFetch('/accounts/account_1', options)).rejects.toBe(failure);

    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse);
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/accounts/account_1`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer new-access-token' },
    });
  });

  it.each([
    ['network rejection', new TypeError('Refresh network unavailable')],
    ['cancellation', new DOMException('Refresh cancelled', 'AbortError')],
  ])('preserves the session after refresh %s', async (_label, failure) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockRejectedValueOnce(failure);

    await expect(authenticatedFetch('/accounts')).rejects.toBe(failure);

    expect(onSessionLost).not.toHaveBeenCalled();
    expect(onSessionRefreshed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500])('preserves the session after refresh HTTP %s', async (status) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(status, { detail: 'Refresh temporarily unavailable' }));

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({
      message: 'Refresh temporarily unavailable', status,
    });

    expect(onSessionLost).not.toHaveBeenCalled();
    expect(onSessionRefreshed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ends the session when refresh rejects its authentication', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Refresh token is not active' }));

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Session expired', status: 401 });

    expect(onSessionLost).toHaveBeenCalledOnce();
    expect(onSessionRefreshed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 500])('surfaces retry HTTP %s without another refresh or session loss', async (status) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(200, refreshedAuthResponse))
      .mockResolvedValueOnce(jsonResponse(status, { detail: 'Retried request rejected' }, status === 401));

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Retried request rejected', status });

    expect(onSessionLost).not.toHaveBeenCalled();
    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares refresh while a failed retry leaves another request authenticated', async () => {
    let releaseRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    let reportBothInitialRequests!: () => void;
    const bothInitialRequests = new Promise<void>((resolve) => { reportBothInitialRequests = resolve; });
    let originalRequests = 0;
    const failure = new TypeError('Accounts request disconnected');
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url === `${API_BASE}/auth/refresh`) return refreshResponse;
      if (new Headers(options.headers).get('Authorization') === 'Bearer old-access-token') {
        originalRequests += 1;
        if (originalRequests === 2) reportBothInitialRequests();
        return jsonResponse(401, { detail: 'Expired access token' }, true);
      }
      if (url === `${API_BASE}/accounts`) throw failure;
      return jsonResponse(200, { budgets: [] });
    });

    const accounts = authenticatedFetch('/accounts').catch((error: unknown) => error);
    const budgets = authenticatedFetch('/budgets');
    await bothInitialRequests;
    releaseRefresh(jsonResponse(200, refreshedAuthResponse));

    expect(await accounts).toBe(failure);
    await expect(budgets).resolves.toEqual({ budgets: [] });
    expect(fetchMock.mock.calls.filter(([url]) => url === `${API_BASE}/auth/refresh`)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(onSessionRefreshed).toHaveBeenCalledTimes(2);
    expect(onSessionRefreshed).toHaveBeenCalledWith(refreshedAuthResponse);
    expect(onSessionLost).not.toHaveBeenCalled();
    const retried = fetchMock.mock.calls.filter(([, options]) =>
      new Headers(options.headers).get('Authorization') === 'Bearer new-access-token');
    expect(retried.map(([url]) => url).sort()).toEqual([`${API_BASE}/accounts`, `${API_BASE}/budgets`]);
  });

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
