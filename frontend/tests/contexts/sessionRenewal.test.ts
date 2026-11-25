/**
 * Covers a tab taking a renewed session: its own user's renewal carries on and takes the key the
 * saved copy is sealed with, a new key number drops the stored copy, while a renewal that returns
 * another user, signed in since in another tab, signs the tab out with nothing of either user cached
 * and no key held
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SESSION_KEY, type AuthResponse, type User } from '@/api/auth'
import {
  discardSavedCopy,
  QUERY_CACHE_STORAGE_KEY,
  setQueryCacheUser,
  startSavingQueryCache,
} from '@/api/cache/persistence'
import type { AuthState } from '@/contexts/AuthContext'
import { takeRenewedSession } from '@/contexts/sessionRenewal'
import { KEY_FILL, savedCopySession } from '@tests/api/cache/fixtures'

/** Builds a user with the given id */
function user(id: string): User {
  return {
    id,
    email: `${id}@example.com`,
    first_name: 'Test',
    last_name: null,
    tz: 'America/Toronto',
    base_currency: 'CAD',
    date_format: 'month-day-year',
    created_at: '2026-06-12T00:00:00Z',
    second_factor_reenrollment_required: false,
    deletion_due_at: null,
  }
}

const tabState: AuthState = { user: user('user-a'), accessToken: 'old-access-token', loading: false }

/** A renewal that returned this user's session */
function renewalFor(id: string, keyNumber = 0): AuthResponse {
  return {
    ...savedCopySession(keyNumber, KEY_FILL, id),
    user: user(id),
    access_token: `${id}-access-token`,
    token_type: 'bearer',
  }
}

const clients: QueryClient[] = []

/** A query cache holding the tab's user's data */
function cacheWithAccounts() {
  const client = new QueryClient()
  clients.push(client)
  client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
  return client
}

/** A local storage stand-in backed by a map */
function createStorage(items: Map<string, string>) {
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
  }
}

const stops: (() => void)[] = []

/** A page whose tab is signed in as user-a and saving, and the storage it saves to */
function pageSavingAsUserA(client: QueryClient) {
  const stored = new Map([[SESSION_KEY, 'user-a']])
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: createStorage(stored) }))
  vi.stubGlobal('document', document)
  setQueryCacheUser('user-a')
  stops.push(startSavingQueryCache(client))
  const hide = () => {
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  }
  return { stored, hide }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  for (const client of clients.splice(0)) client.clear()
  discardSavedCopy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('signs the tab out and clears its cache when the renewal returns another user', () => {
  const client = cacheWithAccounts()
  const applyState = vi.fn()

  expect(takeRenewedSession(tabState, renewalFor('user-c'), client, applyState)).toBe(false)

  expect(applyState).toHaveBeenCalledExactlyOnceWith({ user: null, accessToken: null, loading: false })
  expect(client.getQueryData(['accounts'])).toBeUndefined()
})

it("takes a renewal for the tab's own user and keeps its cache", () => {
  const client = cacheWithAccounts()
  const applyState = vi.fn()

  expect(takeRenewedSession(tabState, renewalFor('user-a'), client, applyState)).toBe(true)

  expect(applyState).toHaveBeenCalledExactlyOnceWith({
    user: user('user-a'),
    accessToken: 'user-a-access-token',
    loading: false,
  })
  expect(client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }])
})

it("seals the saved copy with the key its own user's renewal carries, and with none before it", async () => {
  const client = cacheWithAccounts()
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
  const page = pageSavingAsUserA(client)

  page.hide()
  client.setQueryData(['accounts'], [{ id: 'changed-account' }])
  page.hide()
  expect(encrypt).not.toHaveBeenCalled()

  takeRenewedSession(tabState, renewalFor('user-a'), client, vi.fn())
  client.setQueryData(['accounts'], [{ id: 'later-account' }])
  page.hide()

  await vi.waitFor(() => expect(page.stored.get(QUERY_CACHE_STORAGE_KEY)).toBeDefined())
  expect(JSON.parse(page.stored.get(QUERY_CACHE_STORAGE_KEY)!)).toMatchObject({ userId: 'user-a', keyNumber: 0 })
})

it('removes the stored copy when a renewal brings a new key number, and not for the same one', async () => {
  const client = cacheWithAccounts()
  const page = pageSavingAsUserA(client)
  takeRenewedSession(tabState, renewalFor('user-a'), client, vi.fn())
  client.setQueryData(['tags'], [{ id: 'saved-tag' }])
  page.hide()
  await vi.waitFor(() => expect(page.stored.get(QUERY_CACHE_STORAGE_KEY)).toBeDefined())

  takeRenewedSession(tabState, renewalFor('user-a'), client, vi.fn())
  expect(page.stored.get(QUERY_CACHE_STORAGE_KEY)).toBeDefined()

  takeRenewedSession(tabState, renewalFor('user-a', 1), client, vi.fn())
  expect(page.stored.get(QUERY_CACHE_STORAGE_KEY)).toBeUndefined()
})

it('forgets the key and leaves the stored copy to its new owner when the renewal returns another user', async () => {
  const client = cacheWithAccounts()
  const page = pageSavingAsUserA(client)
  takeRenewedSession(tabState, renewalFor('user-a'), client, vi.fn())
  client.setQueryData(['tags'], [{ id: 'saved-tag' }])
  page.hide()
  await vi.waitFor(() => expect(page.stored.get(QUERY_CACHE_STORAGE_KEY)).toBeDefined())
  const copy = page.stored.get(QUERY_CACHE_STORAGE_KEY)
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt')

  takeRenewedSession(tabState, renewalFor('user-c'), client, vi.fn())
  client.setQueryData(['tags'], [{ id: 'changed-tag' }])
  page.hide()

  expect(encrypt).not.toHaveBeenCalled()
  expect(page.stored.get(QUERY_CACHE_STORAGE_KEY)).toBe(copy)
})
