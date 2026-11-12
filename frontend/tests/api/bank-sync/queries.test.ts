/**
 * Covers how the bank link list is read and how Sync now writes its answer into it, through the
 * query cache the app runs on
 *
 * These tests catch a server without the route being asked again on every retry or every screen
 * that opens, a read that failed on the way not being tried once more, a screen opening moments
 * after a read asking for the list again, a Sync now answer waiting for the next poll to show, a
 * Sync now reading as started before a worker has started it, including on a link made after the
 * list was read, a refused Sync now leaving an out-of-date status in place, a tab in the background
 * reading the list on the poll's timer, a tab the user comes back to showing what it read before it
 * went to the background until the next tick, a user with no links read on every return, and a bank
 * read that keeps going once the screen that started it is gone
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  environmentManager,
  focusManager,
  MutationObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBankLink, createSyncStatus } from './fixtures'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}))

import { ApiError } from '@/api/auth/errors'
import { BANK_LINKS_ACTIVE_POLL_MS, BANK_LINKS_IDLE_POLL_MS } from '@/api/bank-sync/constants'
import {
  bankLinksHeartbeatQueryOptions,
  bankLinksQueryOptions,
  syncBankAccountMutationOptions,
  useAccountBankStatus,
  useBankConnections,
  useBankProviders,
  useDiscoveredBankAccounts,
  useImportRange,
  usePendingBankTransactions,
  useReviewBacklogs,
  useReviewItems,
} from '@/api/bank-sync/hooks'
import { getBankLinksPollInterval } from '@/api/bank-sync/polling'
import type { BankLink } from '@/api/bank-sync/types'
import { bankSyncKeys } from '@/api/cache/queryKeys'

let queryClient: QueryClient
let unsubscribes: Array<() => void> = []

beforeEach(() => {
  authenticatedFetchMock.mockReset()

  // No wait between attempts. The library otherwise spaces them a second apart
  queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
})

afterEach(() => {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes = []
  queryClient.clear()
  vi.useRealTimers()
})

/** Mounts a reader of the link list, the way a screen showing bank status does, once any read it starts has settled */
async function mountReader(): Promise<void> {
  const observer = new QueryObserver(queryClient, bankLinksQueryOptions)
  unsubscribes.push(observer.subscribe(() => {}))
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'))
}

describe('the link list read', () => {
  it('asks a server that refused the read once, without a retry, and not again for the next screen', async () => {
    authenticatedFetchMock.mockRejectedValue(new ApiError('Not Found', 404))

    await mountReader()
    await mountReader()

    expect(authenticatedFetchMock).toHaveBeenCalledOnce()
  })

  it('tries a read that failed on the way once more, and leaves it failed for the next screen', async () => {
    authenticatedFetchMock.mockRejectedValue(new TypeError('Network unavailable'))

    await mountReader()
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)

    await mountReader()
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives a screen opening moments after a read the list it read', async () => {
    authenticatedFetchMock.mockResolvedValue([createBankLink()])

    await mountReader()
    await mountReader()

    expect(authenticatedFetchMock.mock.calls).toEqual([
      ['/bank-sync/links', expect.objectContaining({ signal: expect.any(AbortSignal) })],
    ])
  })
})

describe('a bank sync read a screen starts', () => {
  it.each([
    ['the providers', () => useBankProviders()],
    ['the connections', () => useBankConnections()],
    ['a connection’s bank accounts', () => useDiscoveredBankAccounts('connection-1', 'account-1')],
    ['an account’s link', () => useAccountBankStatus('account-1', true)],
    ['the import range', () => useImportRange('account-1', 'simplefin', true)],
    ['the review items', () => useReviewItems(undefined)],
    ['the review backlogs', () => useReviewBacklogs(undefined)],
    ['the pending transactions', () => usePendingBankTransactions(undefined)],
  ])('hands the request for %s the signal that stops it once the screen is gone', async (_label, read) => {
    authenticatedFetchMock.mockResolvedValue([])

    // Rendered once to build the screen's query in the cache. The query is then read as the app would
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(() => {
          read()
          return null
        }),
      ),
    )
    const [query] = queryClient.getQueryCache().getAll()
    await query.fetch().catch(() => undefined)

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})

describe('the heartbeat, as the user leaves the tab and comes back', () => {
  const FIVE_MINUTES_MS = 5 * 60 * 1000
  let wasServer: boolean

  beforeEach(() => {
    vi.useFakeTimers()

    // The app turns reading again on coming back off for every query, so only the heartbeat's own
    // choice counts
    queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, refetchOnWindowFocus: false } } })

    // The library runs the poll's timer only where it takes itself to be in a browser. These
    // tests aren't, and it hears the tab coming back only through a mounted client
    wasServer = environmentManager.isServer()
    environmentManager.setIsServer(() => false)
    queryClient.mount()
  })

  afterEach(() => {
    queryClient.unmount()
    focusManager.setFocused(undefined)
    environmentManager.setIsServer(() => wasServer)
  })

  /** Mounts the heartbeat with the tab in view, once its first read has settled */
  async function mountHeartbeat() {
    const observer = new QueryObserver(queryClient, bankLinksHeartbeatQueryOptions)
    unsubscribes.push(observer.subscribe(() => {}))
    await vi.advanceTimersByTimeAsync(0)
    return observer
  }

  /** Moves the tab to the background or brings it back, once whatever that starts has settled */
  async function setTabInView(inView: boolean): Promise<void> {
    focusManager.setFocused(inView)
    await vi.advanceTimersByTimeAsync(0)
  }

  it('reads once a minute while the tab is in view, and not at all over five minutes in the background', async () => {
    authenticatedFetchMock.mockResolvedValue([createBankLink()])

    await mountHeartbeat()
    await vi.advanceTimersByTimeAsync(BANK_LINKS_IDLE_POLL_MS)
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)

    await setTabInView(false)
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS)
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads at once when the user comes back within a minute of the last read, so a link needing attention shows before the next tick', async () => {
    authenticatedFetchMock.mockResolvedValue([createBankLink()])
    const observer = await mountHeartbeat()

    await setTabInView(false)
    authenticatedFetchMock.mockResolvedValue([
      createBankLink({ sync: createSyncStatus({ state: 'reconnect_needed' }) }),
    ])
    await vi.advanceTimersByTimeAsync(BANK_LINKS_IDLE_POLL_MS / 2)

    await setTabInView(true)
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2)
    expect(observer.getCurrentResult().data?.map((link) => link.sync.state)).toEqual(['reconnect_needed'])
  })

  it('reads nothing when a user with no links comes back, since nothing polls for them', async () => {
    authenticatedFetchMock.mockResolvedValue([])
    await mountHeartbeat()

    await setTabInView(false)
    await setTabInView(true)
    expect(authenticatedFetchMock).toHaveBeenCalledOnce()
  })
})

describe('a Sync now answer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink(), createBankLink({ account_id: 'account-2' })])
  })

  /** Asks for a sync of the first account, letting the clock run past the minimum time a pending button shows for */
  async function syncNow(): Promise<MutationObserver<BankLink, Error, string>> {
    const observer = new MutationObserver(queryClient, syncBankAccountMutationOptions(queryClient))
    void observer.mutate('account-1').catch(() => {})
    await vi.runAllTimersAsync()
    return observer
  }

  it('goes into the cached list at once, taking the poll to its fast pace, and settles only once the poll shows a worker started the sync', async () => {
    // The server queued the sync and no worker has started it yet, so the link still reads as synced
    authenticatedFetchMock.mockResolvedValue(createBankLink({ sync: createSyncStatus({ sync_requested: true }) }))

    const observer = await syncNow()

    const links = queryClient.getQueryData<BankLink[]>(bankSyncKeys.links())
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/accounts/account-1/bank-link/sync',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(links?.map((link) => [link.account_id, link.sync.state, link.sync.sync_requested])).toEqual([
      ['account-1', 'synced', true],
      ['account-2', 'synced', false],
    ])
    expect(getBankLinksPollInterval(links, null)).toBe(BANK_LINKS_ACTIVE_POLL_MS)
    expect(observer.getCurrentResult().isPending).toBe(true)

    // The next poll finds a worker running the sync
    queryClient.setQueryData(bankSyncKeys.links(), [
      createBankLink({ sync: createSyncStatus({ state: 'syncing' }) }),
      createBankLink({ account_id: 'account-2' }),
    ])
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    expect(queryClient.getQueryState(bankSyncKeys.links())?.isInvalidated).toBe(false)
  })

  it('goes last into a list read before the link was made, so the poll still follows the sync and waits for a worker to start it', async () => {
    // The page read the list, or restored it from storage, before the link was made on another device
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink({ account_id: 'account-2' })])
    authenticatedFetchMock.mockResolvedValue(createBankLink({ sync: createSyncStatus({ sync_requested: true }) }))

    const observer = await syncNow()

    const links = queryClient.getQueryData<BankLink[]>(bankSyncKeys.links())
    expect(links?.map((link) => [link.account_id, link.sync.sync_requested])).toEqual([
      ['account-2', false],
      ['account-1', true],
    ])
    expect(getBankLinksPollInterval(links, null)).toBe(BANK_LINKS_ACTIVE_POLL_MS)
    expect(observer.getCurrentResult().isPending).toBe(true)
  })

  it('marks the list for reading again when the server refuses the sync, since the status shown is out of date', async () => {
    authenticatedFetchMock.mockRejectedValue(new ApiError('Conflict', 409))

    await syncNow()

    expect(queryClient.getQueryState(bankSyncKeys.links())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryData<BankLink[]>(bankSyncKeys.links())?.map((link) => link.sync.state)).toEqual([
      'synced',
      'synced',
    ])
  })
})
