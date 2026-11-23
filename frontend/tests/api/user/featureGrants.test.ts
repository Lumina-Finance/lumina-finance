/**
 * Covers how the features the user is granted are read, through the query cache the app runs on
 *
 * These tests catch a build with no screen asking the server anyway, the read sent to the wrong
 * address, and a page opened again showing what an earlier visit read without asking. A user whose
 * allowance changed would then stay on the old answer
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

import { featureGrantsQueryOptions } from '@/api/user/hooks'

let queryClient: QueryClient
let unsubscribes: Array<() => void> = []

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue({ features: ['insights'] })
  queryClient = new QueryClient()
})

afterEach(() => {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes = []
  queryClient.clear()
})

/** Mounts a reader, the way a covered page opening does, once any read it starts has settled */
async function mountReader(enabled: boolean) {
  const observer = new QueryObserver(queryClient, featureGrantsQueryOptions(enabled))
  unsubscribes.push(observer.subscribe(() => {}))
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'))
  return observer.getCurrentResult()
}

describe('the feature grants read', () => {
  it('never asks the server while it is turned off', async () => {
    const result = await mountReader(false)

    expect(authenticatedFetchMock).not.toHaveBeenCalled()
    expect(result.data).toBeUndefined()
  })

  it('asks for the signed-in user’s feature grants and gives the answer', async () => {
    const result = await mountReader(true)

    expect(authenticatedFetchMock.mock.calls).toEqual([
      ['/me/feature-grants', expect.objectContaining({ signal: expect.any(AbortSignal) })],
    ])
    expect(result.data).toEqual({ features: ['insights'] })
  })

  it('asks again each time a page that reads it opens', async () => {
    await mountReader(true)
    authenticatedFetchMock.mockResolvedValue({ features: [] })

    const result = await mountReader(true)

    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual({ features: [] })
  })
})
