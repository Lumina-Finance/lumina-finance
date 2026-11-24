/**
 * Covers how the profile with the other currencies sentence is read, through the query cache the app runs on
 *
 * These tests catch the read sent to the wrong address, a build asking while turned off, and a
 * difference in the change check, the currencies token included, leaving the sentence as it was. A
 * renewed session replaces the signed-in user only, so the sentence has to live in this query alone
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}))

import { invalidateAppData } from '@/api/cache/invalidation'
import { userKeys } from '@/api/cache/queryKeys'
import { profileQueryOptions } from '@/api/user/hooks'

let queryClient: QueryClient
let unsubscribes: Array<() => void> = []

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue({ id: 'user-1', foreign_currencies_refusal: 'Not on this server' })
  queryClient = new QueryClient()
})

afterEach(() => {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes = []
  queryClient.clear()
})

async function mountReader(enabled: boolean) {
  const observer = new QueryObserver(queryClient, profileQueryOptions(enabled))
  unsubscribes.push(observer.subscribe(() => {}))
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'))
  return observer.getCurrentResult()
}

describe('the profile read', () => {
  it('never asks the server while it is turned off', async () => {
    await mountReader(false)

    expect(authenticatedFetchMock).not.toHaveBeenCalled()
  })

  it('asks for the profile and keeps the sentence under its own key', async () => {
    const result = await mountReader(true)

    expect(authenticatedFetchMock.mock.calls).toEqual([
      ['/me', expect.objectContaining({ signal: expect.any(AbortSignal) })],
    ])
    expect(result.data?.foreign_currencies_refusal).toBe('Not on this server')
    expect(queryClient.getQueryData(userKeys.profile())).toBe(result.data)
  })

  it('reads the sentence again when the change check finds a difference', async () => {
    await mountReader(true)
    authenticatedFetchMock.mockResolvedValue({ id: 'user-1', foreign_currencies_refusal: null })

    invalidateAppData(queryClient)

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(userKeys.profile())).toMatchObject({ foreign_currencies_refusal: null }),
    )
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)
  })
})
