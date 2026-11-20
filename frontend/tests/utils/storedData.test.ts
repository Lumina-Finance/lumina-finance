/**
 * Guards the error screen's reload onto empty storage: unloading the page for that reload must not
 * save the in-memory query cache, the state suspected of the crash, back into the cleared storage
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { SESSION_KEY } from '@/api/auth'
import {
  discardSavedCopy,
  QUERY_CACHE_STORAGE_KEY,
  setQueryCacheUser,
  startSavingQueryCache,
  takeSavedCopyKey,
} from '@/api/cache/persistence'
import { clearStoredData } from '@/utils/storedData'
import { savedCopySession } from '@tests/api/cache/fixtures'

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
    clear: () => items.clear(),
  }
}

afterEach(() => {
  discardSavedCopy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('leaves only the session flag behind through the reload after clearing stored data', async () => {
  // Vitest runs without a DOM, so the window and document the save listens to are stand-ins
  const stored = new Map([[SESSION_KEY, 'user-a']])
  const page = Object.assign(new EventTarget(), {
    localStorage: createStorage(stored),
    sessionStorage: createStorage(new Map()),
  })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', page)
  vi.stubGlobal('document', document)
  const hide = () => {
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  }
  const client = new QueryClient()
  takeSavedCopyKey(savedCopySession())
  setQueryCacheUser('user-a')
  const stopSaving = startSavingQueryCache(client)

  // Hiding the page saves a change until stored data is cleared
  client.setQueryData(['accounts'], [{ id: 'account-before-the-crash' }])
  hide()
  await vi.waitFor(() => expect(stored.get(QUERY_CACHE_STORAGE_KEY)).toBeDefined())

  // A save of the crashed state is under way as the storage is cleared
  const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
  client.setQueryData(['accounts'], [{ id: 'account-from-the-crash' }])
  hide()
  clearStoredData()
  hide()
  page.dispatchEvent(new Event('pagehide'))
  // The fence: the save's encryption has finished, and a turn later its write would have landed
  await vi.waitFor(() => expect(encrypt).toHaveBeenCalledOnce())
  await Promise.all(encrypt.mock.results.map((result) => result.value))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect([...stored]).toEqual([[SESSION_KEY, 'user-a']])
  stopSaving()
  client.clear()
})
