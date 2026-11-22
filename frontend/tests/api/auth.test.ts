/**
 * Covers auth API request functions that manage login, signup, refresh, and logout
 *
 * These tests catch regressions where auth endpoints lose cookie credentials,
 * JSON headers, bearer logout headers, or backend error details, and where restoring the
 * session on page load signs the user out over a server error rather than a refused session, or
 * a proxy's page is taken for the app's own answer, or the app's answer for a proxy's page
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@/api/config'
import {
  ApiError,
  checkResetLink,
  confirmSignup,
  getSessionRestoreFailure,
  isAnsweredByApp,
  login,
  logout,
  refresh,
  resetPassword,
  restoreSession,
  signup,
  verifyResetMfa,
} from '@/api/auth'
import type { AuthResponse } from '@/api/auth'
import { REQUEST_TIMEOUT_MS } from '@/api/server'
import { answerNever } from './fixtures'

const authResponse: AuthResponse = {
  user: {
    id: 'user_123',
    email: 'daniel@example.com',
    first_name: 'Daniel',
    last_name: null,
    tz: 'America/Toronto',
    base_currency: 'CAD',
    date_format: 'month-day-year',
    created_at: '2026-06-12T00:00:00Z',
    second_factor_reenrollment_required: false,
    deletion_due_at: null,
  },
  access_token: 'access-token',
  token_type: 'bearer',
}

const fetchMock = vi.fn()
const REFRESH_REQUEST_LOCK_KEY = 'lumina:refresh_request_lock_until'

function createStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  } as Storage
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => authResponse,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('auth API functions', () => {
  it('logs in with cookie credentials and JSON headers', async () => {
    await expect(
      login({
        email: 'daniel@example.com',
        password: 'secret',
      }),
    ).resolves.toEqual(authResponse)

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        email: 'daniel@example.com',
        password: 'secret',
      }),
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  it('asks for the confirmation email with profile and currency fields and no password', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })

    await expect(
      signup({
        email: 'daniel@example.com',
        first_name: 'Daniel',
        tz: 'America/Toronto',
        base_currency: 'CAD',
      }),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/signup`, {
      method: 'POST',
      body: JSON.stringify({
        email: 'daniel@example.com',
        first_name: 'Daniel',
        tz: 'America/Toronto',
        base_currency: 'CAD',
      }),
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  it('confirms the sign-up with the emailed token and the chosen password', async () => {
    await expect(confirmSignup({ token: 'signed.link.token', new_password: 'StrongPassword1!' })).resolves.toEqual(
      authResponse,
    )

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/signup/confirm`, {
      method: 'POST',
      body: JSON.stringify({ token: 'signed.link.token', new_password: 'StrongPassword1!' }),
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  it('waits for a previous page-load refresh lock before refreshing', async () => {
    vi.useFakeTimers()
    const storage = createStorageMock()
    vi.stubGlobal('window', { localStorage: storage })
    storage.setItem(REFRESH_REQUEST_LOCK_KEY, String(Date.now() + 3_000))

    const request = refresh()

    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3_000)

    await expect(request).resolves.toEqual(authResponse)
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  it('retries refresh when a stale request loses a rotation race', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ detail: 'Refresh token was already rotated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => authResponse,
      })

    const request = refresh()

    await vi.advanceTimersByTimeAsync(100)

    await expect(request).resolves.toEqual(authResponse)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  it('logs out with the active access token', async () => {
    await logout('access-token')

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-token',
      },
      credentials: 'include',
      signal: expect.any(AbortSignal),
    })
  })

  it('raises API errors with backend detail messages', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid credentials' }),
    })

    const request = login({
      email: 'daniel@example.com',
      password: 'wrong',
    })

    await expect(request).rejects.toMatchObject({
      message: 'Invalid credentials',
      status: 401,
    })
    await expect(request).rejects.toBeInstanceOf(ApiError)
  })

  it('keeps the fields a refused signup named', async () => {
    const payload = {
      email: 'daniel@example.test',
      first_name: 'Daniel',
      tz: 'America/Toronto',
      base_currency: 'CAD',
    }
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' }],
      }),
    })

    await expect(signup(payload)).rejects.toMatchObject({
      message: "Oops, the email wasn't accepted. Please check it and try again.",
      fieldErrors: [{ field: 'email', path: ['email'], message: 'value is not a valid email address' }],
      status: 422,
    })
  })
})

describe('restoring the session on page load', () => {
  const failedResponse = (status: number) => new Response(null, { status })

  it('loads signed in when a second attempt answers after a gateway error', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(failedResponse(502))

    const request = restoreSession()
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(request).resolves.toEqual(authResponse)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads signed in when the browser drops the first attempt', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const request = restoreSession()
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(request).resolves.toEqual(authResponse)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tries again when the server never answers the first attempt', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(answerNever)

    const request = restoreSession()
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1_000)

    await expect(request).resolves.toEqual(authResponse)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after a second failure that does not refuse the session', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(failedResponse(503))

    const request = restoreSession()
    const outcome = expect(request).rejects.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(1_000)

    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks only once when the server refuses the session', async () => {
    fetchMock.mockResolvedValueOnce(failedResponse(401))

    await expect(restoreSession()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one restore between callers, its retry included', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(failedResponse(502))

    const requests = Promise.all([restoreSession(), restoreSession()])
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(requests).resolves.toEqual([authResponse, authResponse])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tells a refused session apart from one that lost a rotation race', () => {
    expect(getSessionRestoreFailure(new ApiError('Session is not active', 401))).toBe('rejected')
    expect(getSessionRestoreFailure(new ApiError('Refresh token was already rotated', 409))).toBe('rotated')
  })
})

describe("telling the app's own answer from a proxy's page", () => {
  it.each([
    ['takes a gateway status without a detail for a proxy page', new ApiError('Request failed (504)', 504), false],
    [
      'takes a gateway status with a detail for the app answering',
      new ApiError('Bridge unreachable', 502, { detail: 'Bridge unreachable' }),
      true,
    ],
    ['takes another status without a detail for the app answering', new ApiError('Session expired', 401), true],
  ])('%s', (_title, error, answered) => {
    expect(isAnsweredByApp(error)).toBe(answered)
  })
})

describe('checking a reset link before the new password', () => {
  it('sends the token in the body and passes on the linked provider count', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sign_in_providers_linked: 1 }) })

    await expect(checkResetLink('reset-token')).resolves.toEqual({ sign_in_providers_linked: 1 })

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/auth/password/reset/check`, {
      method: 'POST',
      body: JSON.stringify({ token: 'reset-token' }),
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })
})

describe('finishing a password reset', () => {
  const removedNotice = { sign_in_providers_removed: 2 }
  const challenge = {
    mfa_required: true,
    mfa_token: 'mfa',
    totp_enabled: true,
    passkey_available: false,
    recovery_only: false,
  }
  const payload = { token: 'reset-token', new_password: 'new password', mfa_token: 'mfa', code: '123456' }

  it.each([
    ['nothing else changed', { ok: true, status: 204 }, null],
    [
      'linked sign-in providers were removed',
      { ok: true, status: 200, json: async () => removedNotice },
      removedNotice,
    ],
    ['a second factor is needed first', { ok: true, status: 200, json: async () => challenge }, challenge],
  ])('passes on what the reset answered when %s', async (_label, answer, expected) => {
    fetchMock.mockResolvedValueOnce(answer)

    await expect(resetPassword({ token: 'reset-token', new_password: 'new password' })).resolves.toEqual(expected)
  })

  it.each([
    ['nothing else changed', { ok: true, status: 204 }, null],
    [
      'linked sign-in providers were removed',
      { ok: true, status: 200, json: async () => removedNotice },
      removedNotice,
    ],
    ['a recovery code started re-enrolment', { ok: true, status: 200, json: async () => authResponse }, authResponse],
  ])('passes on what the second factor answered when %s', async (_label, answer, expected) => {
    fetchMock.mockResolvedValueOnce(answer)

    await expect(verifyResetMfa(payload)).resolves.toEqual(expected)
  })
})
