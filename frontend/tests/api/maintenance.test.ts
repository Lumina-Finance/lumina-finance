/**
 * Covers what the page learns from the server's answers: that it is in maintenance, and that it is
 * not any more. A request that fails for another reason must leave what the page says untouched
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAINTENANCE_MESSAGE } from '@/api/auth'
import { authenticatedFetch, registerAuthBindings } from '@/api/client'
import { fetchFromServer } from '@/api/server'
import { fetchAppVersion, getServerNotice, reportMaintenance, subscribeToMaintenance } from '@/api/version'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

const MAINTENANCE_ANSWER = { detail: 'Back soon', maintenance: true }

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  registerAuthBindings({
    getAccessToken: () => 'access-token',
    getAccessTokenExpiresAt: () => null,
    onSessionRefreshed: () => true,
    onSessionLost: vi.fn(),
  })
})

afterEach(() => {
  reportMaintenance(false)
})

describe('a server in maintenance', () => {
  it('is told to the user as maintenance, not as an unreachable server', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, MAINTENANCE_ANSWER))

    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({
      message: MAINTENANCE_MESSAGE,
      isMaintenance: true,
    })
    expect(getServerNotice('1.0.0')).toBe('maintenance')
  })

  it('stops being told once the server answers a request again, and says so at each change only', async () => {
    const changes = vi.fn()
    const unsubscribe = subscribeToMaintenance(changes)
    fetchMock.mockResolvedValueOnce(jsonResponse(503, MAINTENANCE_ANSWER))
    await expect(authenticatedFetch('/accounts')).rejects.toBeDefined()
    fetchMock.mockResolvedValueOnce(jsonResponse(503, MAINTENANCE_ANSWER))
    await expect(authenticatedFetch('/accounts')).rejects.toBeDefined()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    await authenticatedFetch('/accounts')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    await authenticatedFetch('/accounts')
    unsubscribe()

    expect(getServerNotice('1.0.0')).toBeNull()
    expect(changes.mock.calls).toEqual([[true], [false]])
  })

  it.each([
    ['a request that needs no session', () => fetchFromServer('/currencies')],
    ['the version request the error screens use', () => fetchAppVersion()],
  ])('is read from %s as well, not only from the data requests', async (_label, send) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, MAINTENANCE_ANSWER))
    await send().catch(() => undefined)
    expect(getServerNotice('1.0.0')).toBe('maintenance')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { version: '1.0.0', update: null }))
    await send()
    expect(getServerNotice('1.0.0')).toBeNull()
  })

  it('is not guessed from a gateway giving up or a dropped connection', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, null))
    await expect(authenticatedFetch('/accounts')).rejects.toMatchObject({ isMaintenance: false })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(authenticatedFetch('/accounts')).rejects.toBeInstanceOf(TypeError)

    expect(getServerNotice('1.0.0')).toBeNull()
  })

  it('stays told through a dropped connection that follows', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, MAINTENANCE_ANSWER))
    await expect(authenticatedFetch('/accounts')).rejects.toBeDefined()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(authenticatedFetch('/accounts')).rejects.toBeDefined()

    expect(getServerNotice('1.0.0')).toBe('maintenance')
  })
})
