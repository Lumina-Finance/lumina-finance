/**
 * Covers the maintenance file: a server that answers nothing can't say it is in maintenance, so the
 * page asks its own address. Only a file holding the maintenance marker shows maintenance. Everything
 * else leaves what the page says as it was
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFromServer } from '@/api/server'
import { MAINTENANCE_FILE_MIN_INTERVAL_MS, MAINTENANCE_FILE_TIMEOUT_MS } from '@/api/version/maintenanceFile'
import { getServerNotice, reportMaintenance } from '@/api/version'
import { MAINTENANCE_MESSAGE } from '@/api/auth/errors'
import { getAuthErrorMessage } from '@/pages/auth/utils/authForm'
import { getSetupRetryMessage } from '@/utils/setupFailure'

vi.unmock('@/api/version/maintenanceFile')

const fetchMock = vi.fn()

type FileAnswer = () => Promise<Response>

const NO_FILE: FileAnswer = () => Promise.resolve(new Response('Not found', { status: 404 }))

function fileSaying(body: unknown): FileAnswer {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

/** Answers the server's addresses by `api` and the page's own maintenance file by `file` */
function serve({ api, file = NO_FILE }: { api: () => Promise<Response>; file?: FileAnswer }) {
  fetchMock.mockImplementation((url: string) => (url.endsWith('/maintenance.json') ? file() : api()))
}

const NEVER_ANSWERED = () => Promise.reject(new TypeError('Failed to fetch'))

function fileRequests() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/maintenance.json'))
}

// Lets any answer still on its way be read before the test checks the page
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// Each test starts past the interval the page waits between asks, so none inherits another's ask
let now = Date.parse('2026-11-20T12:00:00Z')

beforeEach(() => {
  now += 10 * MAINTENANCE_FILE_MIN_INTERVAL_MS
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  reportMaintenance(false)
  vi.useRealTimers()
})

describe('a request the server never answered', () => {
  it('shows maintenance when the maintenance file says the site is in one', async () => {
    serve({ api: NEVER_ANSWERED, file: fileSaying({ maintenance: true }) })

    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)

    // A screen words the failure where it catches it, so the maintenance is known by then
    expect(getServerNotice('1.0.0')).toBe('maintenance')
    expect(fileRequests()).toEqual([
      ['/maintenance.json', { cache: 'no-store', signal: expect.any(AbortSignal) as AbortSignal }],
    ])
  })

  // The first sign-in or setup failure read "Couldn't reach the server" while the file was on its way
  it('words the first failure as maintenance where it is caught', async () => {
    serve({ api: NEVER_ANSWERED, file: fileSaying({ maintenance: true }) })

    const error: unknown = await fetchFromServer('/auth/login').catch((caught: unknown) => caught)

    expect(getAuthErrorMessage(error)).toBe(MAINTENANCE_MESSAGE)
    expect(getSetupRetryMessage(error)).toBe(MAINTENANCE_MESSAGE)
  })

  it.each([
    ['there is no file', NO_FILE],
    [
      'the web server answers with the app page instead',
      () => Promise.resolve(new Response('<!doctype html><title>Lumina</title>', { status: 200 })),
    ],
    ['the file says maintenance is off', fileSaying({ maintenance: false })],
    ['the file holds something else', fileSaying({ detail: 'Back soon' })],
    ['the file is not reachable either', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('leaves the page as it was when %s', async (_label, file) => {
    serve({ api: NEVER_ANSWERED, file })

    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(1))
    await settle()

    expect(getServerNotice('1.0.0')).toBeNull()
  })

  it('fails the request only once the file has answered', async () => {
    let answerFile: (response: Response) => void = () => undefined
    serve({ api: NEVER_ANSWERED, file: () => new Promise<Response>((resolve) => (answerFile = resolve)) })
    let failed = false

    const request = fetchFromServer('/accounts').catch((error: unknown) => {
      failed = true
      throw error
    })
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(1))
    await settle()
    expect(failed).toBe(false)

    answerFile(new Response(JSON.stringify({ maintenance: true }), { status: 200 }))
    await expect(request).rejects.toBeInstanceOf(TypeError)
    expect(getServerNotice('1.0.0')).toBe('maintenance')
  })

  // A file read that landed after the app answered once brought the notice back until the next retry
  it('leaves the page as it was when the app answers while the file is on its way', async () => {
    let answerFile: (response: Response) => void = () => undefined
    let api: () => Promise<Response> = NEVER_ANSWERED
    serve({ api: () => api(), file: () => new Promise<Response>((resolve) => (answerFile = resolve)) })

    const failedRequest = fetchFromServer('/accounts')
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(1))
    api = () => Promise.resolve(new Response('[]', { status: 200 }))
    await fetchFromServer('/accounts')
    answerFile(new Response(JSON.stringify({ maintenance: true }), { status: 200 }))
    await expect(failedRequest).rejects.toBeInstanceOf(TypeError)

    expect(getServerNotice('1.0.0')).toBeNull()
  })

  it('asks once for a burst of failures, and again only after the interval', async () => {
    serve({ api: NEVER_ANSWERED })

    await Promise.allSettled([fetchFromServer('/accounts'), fetchFromServer('/tags'), fetchFromServer('/me')])
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(1))
    await settle()

    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await settle()
    expect(fileRequests()).toHaveLength(1)

    vi.setSystemTime(now + MAINTENANCE_FILE_MIN_INTERVAL_MS)
    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(2))
  })

  it('asks again after a file that never answers has run out of time', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(now)
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/maintenance.json')
        ? new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          })
        : NEVER_ANSWERED(),
    )

    const first = expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await vi.advanceTimersByTimeAsync(MAINTENANCE_FILE_TIMEOUT_MS)
    await first
    expect(fileRequests()).toHaveLength(1)

    // Within the interval the request fails at once, with no second ask
    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    expect(fileRequests()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(MAINTENANCE_FILE_MIN_INTERVAL_MS)
    const third = expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await vi.advanceTimersByTimeAsync(MAINTENANCE_FILE_TIMEOUT_MS)
    await third
    expect(fileRequests()).toHaveLength(2)
  })

  it('asks again when the clock was set back since the last ask', async () => {
    serve({ api: NEVER_ANSWERED })

    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(1))
    await settle()

    vi.setSystemTime(now - 60 * 60 * 1000)
    await expect(fetchFromServer('/accounts')).rejects.toBeInstanceOf(TypeError)
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(2))
  })

  it('counts a request that ran out of time, and never one the caller cancelled', async () => {
    serve({ api: () => Promise.reject(new DOMException('Cancelled', 'AbortError')) })
    await expect(fetchFromServer('/accounts')).rejects.toMatchObject({ name: 'AbortError' })
    await settle()
    expect(fileRequests()).toHaveLength(0)

    serve({ api: () => Promise.reject(new DOMException('Too slow', 'TimeoutError')) })
    await expect(fetchFromServer('/accounts')).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.waitFor(() => expect(fileRequests()).toHaveLength(1))
  })
})

describe('a request a gateway answered for the server', () => {
  it.each([502, 503, 504])('asks for the file after a %i without the maintenance marker', async (status) => {
    serve({
      api: () => Promise.resolve(new Response('Bad gateway', { status })),
      file: fileSaying({ maintenance: true }),
    })

    await fetchFromServer('/accounts')
    await vi.waitFor(() => expect(getServerNotice('1.0.0')).toBe('maintenance'))
  })

  it('does not ask when the answer carries the maintenance marker', async () => {
    serve({ api: () => Promise.resolve(new Response('{"maintenance": true}', { status: 503 })) })
    await fetchFromServer('/accounts')
    await settle()

    expect(getServerNotice('1.0.0')).toBe('maintenance')
    expect(fileRequests()).toHaveLength(0)
  })

  it('does not ask when the server answered the request itself', async () => {
    for (const status of [400, 401, 404, 409, 422, 500]) {
      serve({ api: () => Promise.resolve(new Response('{}', { status })) })
      await fetchFromServer('/accounts')
    }
    serve({
      api: () => Promise.resolve(new Response('{"detail": "Could not reach the provider"}', { status: 502 })),
      file: fileSaying({ maintenance: true }),
    })
    await fetchFromServer('/accounts')
    await settle()

    expect(fileRequests()).toHaveLength(0)
    expect(getServerNotice('1.0.0')).toBeNull()
  })
})
