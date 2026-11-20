/**
 * Guards stopping the saves of the query cache, as clearing stored data for a reload does: a save
 * that was already encrypting when saving stopped writes nothing, and none starts afterwards. Its own
 * file because stopping lasts for the life of the module
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { SESSION_KEY } from '@/api/auth/session'
import {
  discardSavedCopy,
  QUERY_CACHE_STORAGE_KEY,
  setQueryCacheUser,
  startSavingQueryCache,
  stopSavingQueryCache,
  takeSavedCopyKey,
} from '@/api/cache/persistence'
import { savedCopySession } from '@tests/api/cache/fixtures'

afterEach(() => {
  discardSavedCopy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A page of the first user saving to a local storage stand-in, with a way to hide it */
function loadPage() {
  const stored = new Map([[SESSION_KEY, 'user-a']])
  const localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  }
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }))
  vi.stubGlobal('document', document)
  const client = new QueryClient()
  takeSavedCopyKey(savedCopySession())
  setQueryCacheUser('user-a')
  const stop = startSavingQueryCache(client)
  const hide = () => {
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  }
  return { stored, client, hide, stop }
}

it('writes nothing from a save that was encrypting when saving stopped', async () => {
  const page = loadPage()
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
  page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])

  page.hide()
  stopSavingQueryCache()
  await vi.waitFor(() => expect(encrypt).toHaveBeenCalledOnce())
  await Promise.all(encrypt.mock.results.map((result) => result.value))
  // A turn for the write that follows the encryption
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(page.stored.has(QUERY_CACHE_STORAGE_KEY)).toBe(false)
  page.stop()
})

it('starts no save once saving has stopped', async () => {
  const page = loadPage()
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
  page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])

  stopSavingQueryCache()
  page.hide()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(encrypt).not.toHaveBeenCalled()
  page.stop()
})
