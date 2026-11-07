/**
 * Covers how the connection requests behave through the query cache the app runs on
 *
 * These tests catch a credential waiting, with its form's Cancel held, for a connection the
 * browser says it lacks, a refused claim leaving out a connection an earlier try saved unseen, a
 * failed reconnect holding its message back until the reads it starts end, and a rename showing the
 * old name until the list is read again
 */
import { MutationObserver, onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/auth/errors'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import {
  claimCredentialMutationOptions,
  reconnectBankConnectionMutationOptions,
  renameBankConnectionMutationOptions,
} from '@/api/bank-sync/hooks'
import type { BankConnection } from '@/api/bank-sync/types'
import { bankSyncKeys } from '@/api/cache/queryKeys'

let queryClient: QueryClient

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    nickname: null,
    server_label: 'bridge.simplefin.org',
    created_at: '2026-10-01T15:00:00Z',
    status: 'active',
    accounts: [],
    choose_again_links: [],
    discovery_pending: false,
    request_budget: { limit: 20, used: 0, available_again_at: null, held_by_provider: false },
    ...overrides,
  }
}

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  vi.useFakeTimers()
  queryClient = new QueryClient()
})

afterEach(() => {
  onlineManager.setOnline(true)
  queryClient.clear()
  vi.useRealTimers()
})

describe('a credential sent while offline', () => {
  beforeEach(() => {
    onlineManager.setOnline(false)
    authenticatedFetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  })

  it('fails at once for a claim rather than waiting for a connection', async () => {
    const observer = new MutationObserver(queryClient, claimCredentialMutationOptions(queryClient))

    const sent = observer
      .mutate({ provider: 'simplefin', credentials: { setup_token: 'token' } })
      .catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    expect(observer.getCurrentResult()).toMatchObject({ status: 'error', isPaused: false })
    expect(await sent).toBeInstanceOf(TypeError)
  })

  it('fails at once for a reconnect rather than waiting for a connection', async () => {
    const observer = new MutationObserver(queryClient, reconnectBankConnectionMutationOptions(queryClient))

    const sent = observer
      .mutate({ connectionId: 'connection-1', credentials: { setup_token: 'token' } })
      .catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    expect(observer.getCurrentResult()).toMatchObject({ status: 'error', isPaused: false })
    expect(await sent).toBeInstanceOf(TypeError)
  })
})

describe('a claim the server refused', () => {
  it('reads the connections again, since an earlier try with the same token may have saved one unseen', async () => {
    const refusal = 'This setup token has already been used. Create a new one in SimpleFIN Bridge'
    queryClient.setQueryData(bankSyncKeys.connections(), [])
    authenticatedFetchMock.mockRejectedValue(new ApiError(refusal, 422, { detail: refusal }))
    const observer = new MutationObserver(queryClient, claimCredentialMutationOptions(queryClient))

    const sent = observer
      .mutate({ provider: 'simplefin', credentials: { setup_token: 'token' } })
      .catch(() => undefined)
    await vi.runAllTimersAsync()
    await sent

    expect(queryClient.getQueryState(bankSyncKeys.connections())?.isInvalidated).toBe(true)
  })
})

describe('a reconnect that loses its answer', () => {
  it('shows its failure while the reads it starts are still on their way', async () => {
    queryClient.setQueryData(bankSyncKeys.connections(), [connection()])
    const heldRead = new QueryObserver(queryClient, {
      queryKey: bankSyncKeys.connections(),
      queryFn: () => new Promise<BankConnection[]>(() => {}),
      staleTime: Infinity,
    })
    const unsubscribe = heldRead.subscribe(() => {})
    authenticatedFetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const observer = new MutationObserver(queryClient, reconnectBankConnectionMutationOptions(queryClient))

    void observer.mutate({ connectionId: 'connection-1', credentials: { setup_token: 'token' } }).catch(() => undefined)
    await vi.runAllTimersAsync()

    expect(heldRead.getCurrentResult().isFetching).toBe(true)
    expect(observer.getCurrentResult().status).toBe('error')
    unsubscribe()
  })
})

describe('a rename', () => {
  it('puts the new name in the cached list before the list is read again', async () => {
    queryClient.setQueryData(bankSyncKeys.connections(), [connection(), connection({ id: 'connection-2' })])
    authenticatedFetchMock.mockResolvedValue(connection({ nickname: 'Household' }))
    const observer = new MutationObserver(queryClient, renameBankConnectionMutationOptions(queryClient))

    const renamed = observer.mutate({ connectionId: 'connection-1', nickname: 'Household' })
    await vi.runAllTimersAsync()
    await renamed

    const cached = queryClient.getQueryData<BankConnection[]>(bankSyncKeys.connections())
    expect(cached?.map((entry) => [entry.id, entry.nickname])).toEqual([
      ['connection-1', 'Household'],
      ['connection-2', null],
    ])
  })
})
