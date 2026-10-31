/**
 * Covers authenticated fetch session handling around token refresh and request failures
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AuthResponse } from '@/api/auth'
import { API_BASE } from '@/api/config'
import { authenticatedFetch, registerAuthBindings } from '@/api/client'
import { REQUEST_TIMEOUT_MS, SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { answerNever } from './fixtures'

const refreshedAuthResponse: AuthResponse = {
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
  },
  access_token: 'new-access-token',
  token_type: 'bearer',
}

const fetchMock = vi.fn()
const onSessionRefreshed = vi.fn()
const onSessionLost = vi.fn()

/** Builds a real JSON response for the request chain */
function jsonResponse(status: number, body: unknown, bearer = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: bearer ? { 'WWW-Authenticate': 'Bearer' } : undefined,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  onSessionRefreshed.mockReset()
  onSessionRefreshed.mockReturnValue(true)
  onSessionLost.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  registerAuthBindings({
    getAccessToken: () => 'old-access-token',
    getAccessTokenExpiresAt: () => null,
    onSessionRefreshed,
    onSessionLost,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('authenticatedFetch', () => {
  it.each([
    ['network rejection', new TypeError('Network unavailable'), SERVER_UNREACHABLE_MESSAGE],
    ['cancellation', new DOMException('Request cancelled', 'AbortError'), 'Request cancelled'],
  ])('keeps refreshed auth after retry %s', async (_label, failure, shownMessage) => {
    const controller = new AbortController()
    const options: RequestInit = { method: 'PATCH', body: '{"name":"Updated"}', signal: controller.signal }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(200, refreshedAuthResponse))
      .mockRejectedValueOnce(failure)

    await expect(authenticatedFetch('/accounts/account_1', options)).rejects.toMatchObject({
      name: failure.name,
      message: shownMessage,
    })

    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
    expect(onSessionLost).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/accounts/account_1`, {
      ...options,
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer new-access-token' },
    })
  })

  it.each([
    ['network rejection', new TypeError('Refresh network unavailable'), SERVER_UNREACHABLE_MESSAGE],
    ['cancellation', new DOMException('Refresh cancelled', 'AbortError'), 'Refresh cancelled'],
  ])('preserves the session after refresh %s', async (_label, failure, shownMessage) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockRejectedValueOnce(failure)

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ name: failure.name, message: shownMessage })

    expect(onSessionLost).not.toHaveBeenCalled()
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500])('preserves the session after refresh HTTP %s', async (status) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(status, { detail: 'Refresh temporarily unavailable' }))

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({
      message: 'Refresh temporarily unavailable',
      status,
    })

    expect(onSessionLost).not.toHaveBeenCalled()
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ends the session when refresh rejects its authentication', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Refresh token is not active' }))

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Session expired', status: 401 })

    expect(onSessionLost).toHaveBeenCalledOnce()
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 500])('surfaces retry HTTP %s without another refresh or session loss', async (status) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(200, refreshedAuthResponse))
      .mockResolvedValueOnce(jsonResponse(status, { detail: 'Retried request rejected' }, status === 401))

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Retried request rejected', status })

    expect(onSessionLost).not.toHaveBeenCalled()
    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('shares refresh while a failed retry leaves another request authenticated', async () => {
    let releaseRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      releaseRefresh = resolve
    })
    let reportBothInitialRequests!: () => void
    const bothInitialRequests = new Promise<void>((resolve) => {
      reportBothInitialRequests = resolve
    })
    let originalRequests = 0
    const failure = new TypeError('Accounts request disconnected')
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url === `${API_BASE}/auth/refresh`) return refreshResponse
      if (new Headers(options.headers).get('Authorization') === 'Bearer old-access-token') {
        originalRequests += 1
        if (originalRequests === 2) reportBothInitialRequests()
        return jsonResponse(401, { detail: 'Expired access token' }, true)
      }
      if (url === `${API_BASE}/accounts`) throw failure
      return jsonResponse(200, { budgets: [] })
    })

    const accounts = authenticatedFetch('/accounts').catch((error: unknown) => error)
    const budgets = authenticatedFetch('/budgets')
    await bothInitialRequests
    releaseRefresh(jsonResponse(200, refreshedAuthResponse))

    expect(await accounts).toMatchObject({ message: SERVER_UNREACHABLE_MESSAGE, cause: failure })
    await expect(budgets).resolves.toEqual({ budgets: [] })
    expect(fetchMock.mock.calls.filter(([url]) => url === `${API_BASE}/auth/refresh`)).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
    expect(onSessionLost).not.toHaveBeenCalled()
    const retried = fetchMock.mock.calls.filter(
      ([, options]) => new Headers(options.headers).get('Authorization') === 'Bearer new-access-token',
    )
    expect(retried.map(([url]) => url).sort()).toEqual([`${API_BASE}/accounts`, `${API_BASE}/budgets`])
  })

  it('finishes a shared refresh when one of the requests waiting on it is abandoned', async () => {
    let releaseRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      releaseRefresh = resolve
    })
    let reportBothRefused!: () => void
    const bothRefused = new Promise<void>((resolve) => {
      reportBothRefused = resolve
    })
    let refused = 0
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url === `${API_BASE}/auth/refresh`) return refreshResponse
      options.signal?.throwIfAborted()
      if (new Headers(options.headers).get('Authorization') === 'Bearer old-access-token') {
        refused += 1
        if (refused === 2) reportBothRefused()
        return jsonResponse(401, { detail: 'Expired access token' }, true)
      }
      return jsonResponse(200, { budgets: [] })
    })
    const leftPage = new AbortController()

    const accounts = authenticatedFetch('/accounts', { signal: leftPage.signal }).catch((error: unknown) => error)
    const budgets = authenticatedFetch('/budgets')
    await bothRefused
    leftPage.abort(new DOMException('The page was left', 'AbortError'))
    releaseRefresh(jsonResponse(200, refreshedAuthResponse))

    expect(await accounts).toMatchObject({ name: 'AbortError' })
    await expect(budgets).resolves.toEqual({ budgets: [] })
    const refreshRequest = fetchMock.mock.calls.find(([url]) => url === `${API_BASE}/auth/refresh`)
    expect(refreshRequest?.[1].signal?.aborted).toBe(false)
    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('does not mark the session lost when refresh reports a rotation race', async () => {
    vi.useFakeTimers()
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
      })

    const request = authenticatedFetch('/accounts').catch((error: unknown) => error)

    // Advance past the full rotation retry budget so the loop gives up
    await vi.advanceTimersByTimeAsync(5_000)

    const error = await request

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      message: 'Refresh token was already rotated',
      status: 409,
    })
    expect(onSessionLost).not.toHaveBeenCalled()
    expect(onSessionRefreshed).not.toHaveBeenCalled()
  })

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
      })

    await expect(authenticatedFetch('/accounts')).resolves.toEqual({ accounts: [] })
    expect(onSessionRefreshed).toHaveBeenCalledWith(refreshedAuthResponse)
    expect(onSessionLost).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${API_BASE}/accounts`, {
      credentials: 'include',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer new-access-token',
      },
    })
  })

  // A renewal that returns another person's session, signed in since in another tab, is refused by the
  // tab, which signs itself out, so the request is never resent for that person and its answer can't
  // land in the cache
  it('does not resend the request with a renewed session the tab refused', async () => {
    onSessionRefreshed.mockReturnValueOnce(false)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(200, refreshedAuthResponse))
      .mockResolvedValueOnce(jsonResponse(200, { accounts: ['another person'] }))

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Session expired', status: 401 })

    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE}/auth/refresh`, expect.anything())
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('does not refresh or resend a wrong-credential 401 that lacks the bearer challenge', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ detail: 'Invalid two-factor code' }),
    })

    const error = await authenticatedFetch('/auth/2fa/disable', { method: 'POST' }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'Invalid two-factor code', status: 401 })

    // The request is sent once and never resent, so the failed attempt counts a single time
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('fails a resend the server never answers once the shared limit passes, keeping the session', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired access token' }, true))
      .mockResolvedValueOnce(jsonResponse(200, refreshedAuthResponse))
      .mockImplementationOnce(answerNever)

    const request = authenticatedFetch('/transactions')
    const settled = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

    await settled
    expect(onSessionLost).not.toHaveBeenCalled()
  })
})

describe('a sign-in that has aged out', () => {
  let accessToken: string
  let expiresAt: number | null

  beforeEach(() => {
    accessToken = 'old-access-token'
    expiresAt = Date.now() - 1_000
    registerAuthBindings({
      getAccessToken: () => accessToken,
      getAccessTokenExpiresAt: () => expiresAt,
      onSessionRefreshed: (response) => {
        if (onSessionRefreshed(response) === false) return false
        accessToken = response.access_token
        expiresAt = Date.now() + 900_000
        return true
      },
      onSessionLost,
    })
  })

  /** Lists each data request as its path and the sign-in it carried, leaving out the renewal */
  function sentRequests() {
    return fetchMock.mock.calls
      .filter(([url]) => url !== `${API_BASE}/auth/refresh`)
      .map(([url, options]) => [url, new Headers(options.headers).get('Authorization')])
  }

  it('is renewed once before requests started together are sent, each once with the new sign-in', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === `${API_BASE}/auth/refresh` ? jsonResponse(200, refreshedAuthResponse) : jsonResponse(200, {}),
    )

    await Promise.all([
      authenticatedFetch('/accounts'),
      authenticatedFetch('/merchants'),
      authenticatedFetch('/cache-status'),
    ])

    expect(fetchMock.mock.calls.filter(([url]) => url === `${API_BASE}/auth/refresh`)).toHaveLength(1)
    expect(sentRequests().sort()).toEqual([
      [`${API_BASE}/accounts`, 'Bearer new-access-token'],
      [`${API_BASE}/cache-status`, 'Bearer new-access-token'],
      [`${API_BASE}/merchants`, 'Bearer new-access-token'],
    ])
    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
  })

  it('sends no request when the tab refused the renewed session', async () => {
    onSessionRefreshed.mockReturnValueOnce(false)
    fetchMock.mockImplementation(async (url: string) =>
      url === `${API_BASE}/auth/refresh` ? jsonResponse(200, refreshedAuthResponse) : jsonResponse(200, {}),
    )

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Session expired', status: 401 })

    expect(onSessionRefreshed).toHaveBeenCalledExactlyOnceWith(refreshedAuthResponse)
    expect(sentRequests()).toEqual([])
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  // A request sent with seconds left could expire on its way, so the margin is half a minute
  it('is renewed first when only seconds of its lifetime are left', async () => {
    expiresAt = Date.now() + 10_000
    fetchMock.mockImplementation(async (url: string) =>
      url === `${API_BASE}/auth/refresh` ? jsonResponse(200, refreshedAuthResponse) : jsonResponse(200, {}),
    )

    await authenticatedFetch('/accounts')

    expect(sentRequests()).toEqual([[`${API_BASE}/accounts`, 'Bearer new-access-token']])
  })

  it('is not renewed while a minute of its lifetime is left', async () => {
    expiresAt = Date.now() + 60_000
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await authenticatedFetch('/accounts')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(sentRequests()).toEqual([[`${API_BASE}/accounts`, 'Bearer old-access-token']])
  })

  it('signs the user out and sends nothing when the renewal is refused', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'Session is not active' }))

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ message: 'Session expired', status: 401 })

    expect(onSessionLost).toHaveBeenCalledOnce()
    expect(sentRequests()).toEqual([])
  })

  it('still sends the request with the sign-in it has when the renewal fails for a while', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { detail: 'Refresh temporarily unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, { accounts: [] }))

    await expect(authenticatedFetch('/accounts')).resolves.toEqual({ accounts: [] })

    expect(onSessionLost).not.toHaveBeenCalled()
    expect(sentRequests()).toEqual([[`${API_BASE}/accounts`, 'Bearer old-access-token']])
  })
})

describe('what a refused request says', () => {
  it.each([
    ['no body', () => new Response('', { status: 500 })],
    ['a gateway page', () => new Response('<html>Bad Gateway</html>', { status: 502 })],
  ])('says something went wrong, keeping the status, for %s', async (_label, respond) => {
    fetchMock.mockResolvedValueOnce(respond())

    const error = await authenticatedFetch('/tags', { method: 'POST' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('Oops, something went wrong. Please try again.')
    expect((error as ApiError).detail).toBeUndefined()
    expect((error as ApiError).status).toBe(respond().status)
  })

  it('passes on the sentence the server explained the refusal with', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: 'Tag with this name already exists' }))

    await expect(authenticatedFetch('/tags', { method: 'POST' })).rejects.toMatchObject({
      message: 'Tag with this name already exists',
      detail: 'Tag with this name already exists',
      status: 409,
    })
  })
})
