/**
 * Guards the saved copy of the query cache that every tab shares: it holds nothing readable without
 * the key the session renewal returns, and a load opens it only with that key, removing unread a
 * copy of another key number, another user, another shape or the old plain-text form. A late or
 * older write can never leave a copy behind that the session no longer allows, a tab with nothing
 * new must not put its older copy over another tab's, hiding the page never removes the copy while
 * leaving it does when it can't be brought up to date, a save that fails must not leave an older
 * copy behind for the next load to restore as fresh, and no save may write a request held while
 * offline along with what it sends, such as both passwords of a password change, the authenticator
 * secret and setup link of a setup in progress, or an emailed reset token
 */
import { focusManager, MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_KEY } from '@/api/auth'
import {
  discardSavedCopy,
  dropSavedCopyKey,
  QUERY_CACHE_STORAGE_KEY,
  readEntryObservedAt,
  removeUnreadableSavedCopy,
  restoreSavedQueryCache,
  setQueryCacheUser,
  startSavingQueryCache,
  takeSavedCopyKey,
} from '@/api/cache/persistence'
import { getCheckRecord, setCheckRecord } from '@/api/cache/cacheCheck'
import { authKeys, twoFactorKeys } from '@/api/cache/queryKeys'
import { clearUserScopedCache } from '@/api/cache/session'
import { importSavedCopyKey, openSavedCopy, sealSavedCopy } from '@/api/cache/savedCopyCipher'
import type { TotpSetupResponse } from '@/api/two-factor'
import { changePassword, type ChangePasswordPayload } from '@/api/user'
import { KEY_FILL, OTHER_KEY_FILL, savedCopySession } from '@tests/api/cache/fixtures'

// A session response that carries no key, as a native app's does
const WITHOUT_KEY = { user: { id: 'user-a' } }

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  authenticatedFetch: authenticatedFetchMock,
}))

const USER_A = 'user-a'
const USER_C = 'user-c'
const DAY_MS = 24 * 60 * 60 * 1000
const SIX_MONTHS_MS = 180 * DAY_MS

// A copy as versions before encryption stored it, holding the data itself
const OLD_PLAIN_TEXT_COPY = JSON.stringify({
  buster: '9:user-a',
  timestamp: 1,
  clientState: { queries: [{ queryKey: ['accounts'], state: { data: [{ id: 'plain-text-account' }] } }] },
})

const clients: QueryClient[] = []
const stops: (() => void)[] = []

/** A local storage stand-in backed by a map, whose writes a test can make fail */
class FakeStorage {
  readonly items = new Map<string, string>()
  failWrites = false

  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('The quota has been exceeded', 'QuotaExceededError')
    this.items.set(key, value)
  }

  removeItem(key: string) {
    this.items.delete(key)
  }
}

/**
 * Stands in for the window and document the saves use, since vitest runs without a DOM, and starts
 * saving as the page does once its restore settles
 *
 * @param stored - What local storage holds as the page loads
 * @param options.user - The user the tab is signed in as, by default the one the stored flag names
 * @param options.session - The key fields the session came with, the first key unless given
 * @returns The page's local storage and query client, ways to hide, show and leave the page, and the
 * restore the page runs on loading
 */
function loadPage(
  stored: Record<string, string>,
  {
    user = stored[SESSION_KEY] ?? null,
    session = savedCopySession(),
  }: { user?: string | null; session?: Parameters<typeof takeSavedCopyKey>[0] } = {},
) {
  const localStorage = new FakeStorage()
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value)
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const window = Object.assign(new EventTarget(), { localStorage })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)

  const client = new QueryClient()
  clients.push(client)
  // A page that loads holds no key yet, where a tab already holding one for the same user and number keeps it
  dropSavedCopyKey()
  takeSavedCopyKey(session)
  setQueryCacheUser(user)
  stops.push(startSavingQueryCache(client))

  const hide = () => {
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  }
  const show = () => {
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  }
  const leave = () => window.dispatchEvent(new Event('pagehide'))
  const restore = (userId = USER_A) => restoreSavedQueryCache(client, userId)
  return { localStorage, client, hide, show, leave, restore }
}

/** Every encryption the page started, so a test can wait for the writes they lead to */
let sealing: Promise<unknown>[] = []

/** Lets every save started so far finish encrypting and reach its write */
async function settleSaves() {
  // A save reaches its encryption a step after starting, and a write follows the encryption
  let started: number
  do {
    await vi.advanceTimersByTimeAsync(0)
    started = sealing.length
    await Promise.all(sealing)
    await vi.advanceTimersByTimeAsync(0)
  } while (sealing.length !== started)
}

// The wait between timed saves
const TIMED_SAVE_INTERVAL_MS = 1000

/** Lets a timed save that has waited its interval start, and finish */
async function runTimedSave() {
  await vi.advanceTimersByTimeAsync(TIMED_SAVE_INTERVAL_MS)
  await settleSaves()
}

/** The text the stored copy holds once opened, as the page that saved it could read it */
async function readSavedCopy(page: { localStorage: FakeStorage }, session = savedCopySession()) {
  const stored = page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)
  if (stored === null) return null
  const entry = JSON.parse(stored) as { nonce: string; ciphertext: string }
  return openSavedCopy(await importSavedCopyKey(session.saved_copy_key!), entry)
}

/** The stored copy as a person with the browser profile sees it */
function readStoredEntry(page: { localStorage: FakeStorage }) {
  return JSON.parse(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)!) as Record<string, unknown>
}

beforeEach(() => {
  // The timed save waits a second after the last save started, and the clock moves only when a test
  // advances it, so a write it holds stays held until a test moves the clock that far
  vi.useFakeTimers()
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle)
  sealing = []
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((...args) => {
    const sealed = encrypt(...args)
    sealing.push(sealed)
    return sealed
  })
})

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  for (const client of clients.splice(0)) client.clear()
  discardSavedCopy()
  onlineManager.setOnline(true)
  focusManager.setFocused(undefined)
  authenticatedFetchMock.mockReset()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('what is stored', () => {
  it('holds nothing readable, a fresh nonce on every save, and gives the data back to the key that saved it', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account', name: 'Offshore Holdings' }])
    page.hide()
    await settleSaves()

    const first = readStoredEntry(page)
    const storedText = page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)!
    expect(storedText).not.toContain('first-user-account')
    expect(storedText).not.toContain('Offshore Holdings')
    expect(Object.keys(first).toSorted()).toEqual(['ciphertext', 'keyNumber', 'nonce', 'savedAt', 'shape', 'userId'])
    expect(first).toMatchObject({ userId: USER_A, keyNumber: 0 })
    await expect(readSavedCopy(page)).resolves.toContain('Offshore Holdings')

    page.client.setQueryData(['tags'], [{ id: 'second-save-tag' }])
    page.hide()
    await settleSaves()
    const second = readStoredEntry(page)
    expect(second.nonce).not.toBe(first.nonce)
    expect(second.ciphertext).not.toBe(first.ciphertext)
    await expect(readSavedCopy(page)).resolves.toContain('second-save-tag')
  })

  it('is no copy at all without the key the renewal returned', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A }, { session: WITHOUT_KEY })
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    page.hide()
    await settleSaves()

    expect(sealing).toEqual([])
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })
})

/** What local storage holds once a page of the first user has saved a copy of the cache */
async function savedCopyOf(
  setUp: (client: QueryClient) => void = (client) => {
    client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
  },
) {
  const saving = loadPage({ [SESSION_KEY]: USER_A })
  setUp(saving.client)
  saving.hide()
  await settleSaves()
  return Object.fromEntries(saving.localStorage.items)
}

/**
 * Holds the next encryption until the returned function is called, so a save stays under way
 * while the test changes what it was started for
 */
function holdNextEncryption() {
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle)
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let sealed!: Promise<ArrayBuffer>
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce((...args) => {
    sealed = released.then(() => encrypt(...args))
    return sealed
  })
  return {
    release: async () => {
      release()
      await sealed
      await vi.advanceTimersByTimeAsync(0)
    },
  }
}

describe('restoring the saved copy', () => {
  it('restores a saved copy for the user and key number that saved it', async () => {
    const stored = await savedCopyOf()

    const reloaded = loadPage(stored)
    await reloaded.restore()

    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }])
    expect(reloaded.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(stored[QUERY_CACHE_STORAGE_KEY])
  })

  it('removes a copy saved under another key number without opening it', async () => {
    const stored = await savedCopyOf()
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')

    const reloaded = loadPage(stored, { session: savedCopySession(1) })
    await reloaded.restore()

    expect(decrypt).not.toHaveBeenCalled()
    expect(reloaded.client.getQueryData(['accounts'])).toBeUndefined()
    expect(reloaded.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('removes a copy the key cannot open, such as one a different key sealed under the same number', async () => {
    const stored = await savedCopyOf()

    const reloaded = loadPage(stored, { session: savedCopySession(0, OTHER_KEY_FILL) })
    await reloaded.restore()

    expect(reloaded.client.getQueryData(['accounts'])).toBeUndefined()
    expect(reloaded.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('removes a copy in the old plain-text form unread, showing nothing of it', async () => {
    const reloaded = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: OLD_PLAIN_TEXT_COPY })
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')

    await reloaded.restore()

    expect(decrypt).not.toHaveBeenCalled()
    expect(reloaded.client.getQueryData(['accounts'])).toBeUndefined()
    expect(reloaded.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('removes a copy of another user without opening it', async () => {
    const stored = await savedCopyOf()
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')

    const otherLoad = loadPage({ ...stored, [SESSION_KEY]: USER_C })
    await otherLoad.restore(USER_C)

    expect(decrypt).not.toHaveBeenCalled()
    expect(otherLoad.client.getQueryData(['accounts'])).toBeUndefined()
    expect(otherLoad.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('removes a copy saved before budget lists carried one row per budget, even one holding bank holds', async () => {
    const stored = await savedCopyOf((client) =>
      client.setQueryData(['bank-sync', 'holds'], [{ id: 'saved-before-the-hold-card' }]),
    )
    // The shape that was current before, '13'. This copy then reads as saved by it
    stored[QUERY_CACHE_STORAGE_KEY] = JSON.stringify({ ...JSON.parse(stored[QUERY_CACHE_STORAGE_KEY]), shape: '13' })

    const reloaded = loadPage(stored)
    await reloaded.restore()

    expect(reloaded.client.getQueryData(['bank-sync', 'holds'])).toBeUndefined()
    expect(reloaded.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('keeps a copy for six months and removes one a moment older', async () => {
    const stored = await savedCopyOf()
    const savedAt = (JSON.parse(stored[QUERY_CACHE_STORAGE_KEY]) as { savedAt: number }).savedAt

    vi.setSystemTime(savedAt + SIX_MONTHS_MS)
    const onTheLastDay = loadPage(stored)
    await onTheLastDay.restore()
    expect(onTheLastDay.client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }])

    vi.setSystemTime(savedAt + SIX_MONTHS_MS + 1)
    const afterwards = loadPage(stored)
    await afterwards.restore()
    expect(afterwards.client.getQueryData(['accounts'])).toBeUndefined()
    expect(afterwards.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('settles with nothing to restore, and removes what no key is held to open', async () => {
    const empty = loadPage({ [SESSION_KEY]: USER_A })
    await expect(empty.restore()).resolves.toBeUndefined()
    expect(empty.client.getQueryCache().getAll()).toEqual([])

    const stored = await savedCopyOf()
    const withoutKey = loadPage(stored, { session: WITHOUT_KEY })
    await expect(withoutKey.restore()).resolves.toBeUndefined()
    expect(withoutKey.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })
})

describe('saving the query cache', () => {
  it("leaves another tab's copy alone when this tab has changed nothing since its last save", async () => {
    const other = loadPage({ [SESSION_KEY]: USER_A })
    other.client.setQueryData(['tags'], [{ id: 'other-tab-tag' }])
    other.hide()
    await settleSaves()
    const otherTabCopy = other.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)!

    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: otherTabCopy })
    page.hide()
    await settleSaves()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(otherTabCopy)

    page.client.setQueryData(['accounts'], [{ id: 'changed-account' }])
    page.hide()
    await settleSaves()
    await expect(readSavedCopy(page)).resolves.toContain('changed-account')

    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, otherTabCopy)
    page.hide()
    await settleSaves()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(otherTabCopy)
  })

  it("counts a timed save as this tab's save", async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'changed-account' }])
    await runTimedSave()
    await expect(readSavedCopy(page)).resolves.toContain('changed-account')

    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, 'another tab saved this')
    page.hide()
    await settleSaves()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe('another tab saved this')
  })

  it('saves on hiding a change whose timed save is still waiting', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'first-account' }])

    // Saved on hiding, so the clock stands where the save started and the next timed save waits a full interval
    page.hide()
    await settleSaves()
    await expect(readSavedCopy(page)).resolves.toContain('first-account')
    page.client.setQueryData(['accounts'], [{ id: 'second-account' }])
    await vi.advanceTimersByTimeAsync(TIMED_SAVE_INTERVAL_MS - 1)
    await settleSaves()
    await expect(readSavedCopy(page)).resolves.not.toContain('second-account')

    page.hide()
    await settleSaves()

    await expect(readSavedCopy(page)).resolves.toContain('second-account')
  })

  it("saves nothing for this tab's user once another user signs in in another tab, until this tab signs in as them", async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.localStorage.setItem(SESSION_KEY, USER_C)
    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, 'the other tab saved this')

    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    await runTimedSave()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe('the other tab saved this')
    page.hide()
    await settleSaves()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe('the other tab saved this')

    setQueryCacheUser(USER_C)
    page.client.setQueryData(['accounts'], [{ id: 'next-user-account' }])
    page.hide()
    await settleSaves()

    expect(page.localStorage.getItem(SESSION_KEY)).toBe(USER_C)
    await expect(readSavedCopy(page)).resolves.toContain('next-user-account')
    expect(readStoredEntry(page).userId).toBe(USER_C)
  })

  it('stamps a timed save with the user this tab signed in as after loading', async () => {
    const signingIn = loadPage({})
    signingIn.localStorage.setItem(SESSION_KEY, USER_C)
    setQueryCacheUser(USER_C)
    signingIn.client.setQueryData(['accounts'], [{ id: 'next-user-account' }])
    await runTimedSave()
    expect(readStoredEntry(signingIn).userId).toBe(USER_C)

    const reloaded = loadPage(Object.fromEntries(signingIn.localStorage.items))
    await reloaded.restore(USER_C)

    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'next-user-account' }])
  })

  it('leaves nothing when a save is still encrypting as the session ends', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])

    page.hide()
    // Signing out, as the provider does, while the encryption is under way
    page.localStorage.removeItem(SESSION_KEY)
    discardSavedCopy()
    await settleSaves()

    expect(sealing).toHaveLength(1)
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('writes nothing sealed under a key the tab has since replaced, and removes the copy of the old number', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    page.hide()
    await settleSaves()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).not.toBeNull()

    page.client.setQueryData(['accounts'], [{ id: 'second-user-account' }])
    page.hide()
    // A renewal brings the next key number while the encryption is under way
    takeSavedCopyKey(savedCopySession(1))
    await settleSaves()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('never lets an older save finish after a newer one and overwrite it', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle)
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstSealed!: Promise<ArrayBuffer>
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce((...args) => {
      firstSealed = firstHeld.then(() => encrypt(...args))
      return firstSealed
    })

    page.client.setQueryData(['accounts'], [{ id: 'older-account' }])
    page.hide()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    page.hide()
    await settleSaves()
    await expect(readSavedCopy(page)).resolves.toContain('newer-account')

    // The older save finishes encrypting last
    releaseFirst()
    await firstSealed
    await vi.advanceTimersByTimeAsync(0)

    await expect(readSavedCopy(page)).resolves.toContain('newer-account')
    expect(await readSavedCopy(page)).not.toContain('older-account')
  })

  it('never removes the stored copy when the page is hidden, whatever has changed', async () => {
    const older = loadPage({ [SESSION_KEY]: USER_A })
    older.client.setQueryData(['accounts'], [{ id: 'older-account' }])
    older.hide()
    await settleSaves()
    const olderCopy = older.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)!

    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: olderCopy })
    page.client.setQueryData(['accounts'], [{ id: 'changed-account' }])
    page.hide()
    // The encryption has not finished, so the stored copy is still the older one
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(olderCopy)

    await settleSaves()
    await expect(readSavedCopy(page)).resolves.toContain('changed-account')
  })

  it('removes a copy that does not reflect every change when the page is left, and keeps one that does', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'first-account' }])
    page.hide()
    await settleSaves()
    page.show()

    page.leave()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).not.toBeNull()

    page.client.setQueryData(['accounts'], [{ id: 'unsaved-account' }])
    page.leave()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('removes the older saved copy when saving the newer one fails', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    page.hide()
    await settleSaves()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).not.toBeNull()

    page.client.setQueryData(['accounts'], [{ id: 'second-user-account' }])
    page.localStorage.failWrites = true
    page.hide()
    await settleSaves()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
    expect(page.localStorage.getItem(SESSION_KEY)).toBe(USER_A)
  })

  it('keeps query data but not a password change held while offline, and sends the change once back online', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    // Mounted as the app's provider mounts it, since only a mounted client sends held requests once
    // the connection returns
    page.client.mount()
    stops.push(() => page.client.unmount())
    authenticatedFetchMock.mockResolvedValue(undefined)
    page.client.setQueryData(['accounts'], [{ id: 'account-kept' }])

    onlineManager.setOnline(false)
    const payload: ChangePasswordPayload = {
      current_password: 'current-secret-123',
      new_password: 'new-secret-456',
      code: '482915',
    }
    const passwordChange = new MutationObserver(page.client, { mutationFn: changePassword })
    void passwordChange.mutate(payload).catch(() => {})
    expect(passwordChange.getCurrentResult().isPaused).toBe(true)

    const expectNoHeldChangeSaved = async () => {
      const saved = (await readSavedCopy(page)) ?? ''
      expect(JSON.parse(saved).mutations).toEqual([])
      for (const secret of Object.values(payload)) expect(saved).not.toContain(secret)
    }

    // The timed save and the save on hiding the page each write the copy
    await runTimedSave()
    await expect(readSavedCopy(page)).resolves.toContain('account-kept')
    await expectNoHeldChangeSaved()

    page.client.setQueryData(['tags'], [{ id: 'tag-kept' }])
    page.hide()
    await settleSaves()
    await expect(readSavedCopy(page)).resolves.toContain('tag-kept')
    await expectNoHeldChangeSaved()

    // A held request also waits while the page is hidden, so it goes once the user is back on it
    page.show()
    onlineManager.setOnline(true)
    await vi.waitFor(() => expect(passwordChange.getCurrentResult().isSuccess).toBe(true))
    expect(authenticatedFetchMock).toHaveBeenCalledExactlyOnceWith('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  })

  it('keeps query data but not an authenticator setup in progress, through a restart that mints a new secret', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    const firstSetup: TotpSetupResponse = {
      secret: 'JBSWY3DPEHPK3PXP',
      provisioning_uri: 'otpauth://totp/Lumina:a%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Lumina',
    }
    const restartedSetup: TotpSetupResponse = {
      secret: 'KRSXG5CTMVRXEZLU',
      provisioning_uri: 'otpauth://totp/Lumina:a%40example.com?secret=KRSXG5CTMVRXEZLU&issuer=Lumina',
    }
    const setups = [firstSetup, restartedSetup]
    const expectNoSetupSaved = async () => {
      const saved = (await readSavedCopy(page)) ?? ''
      for (const setup of setups) {
        expect(saved).not.toContain(setup.secret)
        expect(saved).not.toContain(setup.provisioning_uri)
      }
    }
    page.client.setQueryData(['accounts'], [{ id: 'account-kept' }])
    page.client.setQueryData(twoFactorKeys.setup(), firstSetup)

    await runTimedSave()
    const timedCopy = await readSavedCopy(page)
    expect(timedCopy).toContain('account-kept')
    await expectNoSetupSaved()

    // Starting setup over mints a new secret under the same key, which the save on hiding the page writes
    page.client.setQueryData(twoFactorKeys.setup(), restartedSetup)
    page.client.setQueryData(['tags'], [{ id: 'tag-kept' }])
    page.hide()
    await settleSaves()
    const hiddenCopy = await readSavedCopy(page)
    expect(hiddenCopy).not.toBe(timedCopy)
    expect(hiddenCopy).toContain('account-kept')
    expect(hiddenCopy).toContain('tag-kept')
    await expectNoSetupSaved()
  })

  it('never saves a reset link check, since its key holds a working reset token', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    const resetToken = 'emailed-reset-token-value'
    page.client.setQueryData(['accounts'], [{ id: 'account-kept' }])
    page.client.setQueryData(authKeys.resetLink(resetToken), { sign_in_providers_linked: 1 })

    await runTimedSave()
    const timedCopy = (await readSavedCopy(page)) ?? ''
    expect(timedCopy).toContain('account-kept')
    expect(timedCopy).not.toContain(resetToken)

    page.hide()
    await settleSaves()
    expect((await readSavedCopy(page)) ?? '').not.toContain(resetToken)
  })
})

describe('what each guard on writing and leaving stops', () => {
  /** A page of the first user whose first change is already saved, the older copy a later save replaces */
  async function pageWithSavedCopy() {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [{ id: 'older-account' }])
    page.hide()
    await settleSaves()
    expect(await readSavedCopy(page)).toContain('older-account')
    return page
  }

  it('removes the copy when the session flag was removed in another tab while this tab still holds the key', async () => {
    const page = await pageWithSavedCopy()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    page.hide()
    page.localStorage.removeItem(SESSION_KEY)
    await settleSaves()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('leaves the older copy when this tab changes user while a save for the first user encrypts', async () => {
    const page = await pageWithSavedCopy()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    page.hide()
    setQueryCacheUser(USER_C)
    await settleSaves()

    expect(await readSavedCopy(page)).toContain('older-account')
  })

  it('writes a save whose key was taken again for the same user and number, and drops one for another user', async () => {
    const page = await pageWithSavedCopy()
    page.client.setQueryData(['accounts'], [{ id: 'second-account' }])
    page.hide()
    takeSavedCopyKey(savedCopySession())
    await settleSaves()
    expect(await readSavedCopy(page)).toContain('second-account')

    page.client.setQueryData(['accounts'], [{ id: 'third-account' }])
    page.hide()
    takeSavedCopyKey(savedCopySession(0, KEY_FILL, USER_C))
    await settleSaves()
    expect(await readSavedCopy(page)).toContain('second-account')
  })

  it('removes the older copy when sealing the newer one fails', async () => {
    const page = await pageWithSavedCopy()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(() => Promise.reject(new Error('not sealed')))
    page.hide()
    await settleSaves()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('writes nothing for a tab with no user, and starts no encryption for it', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A }, { user: null })
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    page.hide()
    await settleSaves()

    expect(sealing).toEqual([])
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['holds no key', { session: WITHOUT_KEY }],
    ['has no user', { user: null }],
  ])('leaves the stored copy alone on leaving the page when the tab %s', (_label, options) => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: 'a copy saved elsewhere' }, options)
    page.client.setQueryData(['accounts'], [{ id: 'unsaved-account' }])

    page.leave()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe('a copy saved elsewhere')
  })

  it('never writes back an older copy from a save still encrypting when the page is left', async () => {
    const page = await pageWithSavedCopy()
    const held = holdNextEncryption()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    page.hide()
    // The held encryption has started, so it is the save still running when the page is left
    await vi.advanceTimersByTimeAsync(0)
    page.client.setQueryData(['accounts'], [{ id: 'newest-account' }])
    page.leave()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()

    await held.release()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('never writes back an older copy from a save still encrypting when a newer one fails', async () => {
    const page = await pageWithSavedCopy()
    const held = holdNextEncryption()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    page.hide()
    page.client.setQueryData(['accounts'], [{ id: 'newest-account' }])
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(() => Promise.reject(new Error('not sealed')))
    page.hide()
    await vi.advanceTimersByTimeAsync(0)
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()

    await held.release()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('still writes a save still encrypting when the page is left with no change since it started', async () => {
    const page = await pageWithSavedCopy()
    const held = holdNextEncryption()
    page.client.setQueryData(['accounts'], [{ id: 'newer-account' }])
    page.hide()
    await vi.advanceTimersByTimeAsync(0)
    page.leave()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()

    // The save holds every change made, so it is current and nothing newer is lost by writing it
    await held.release()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).not.toBeNull()
  })

  it("keeps another tab's newer copy when the copy it read could not be opened", async () => {
    const stored = await savedCopyOf()
    const reloaded = loadPage(stored)
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(() => {
      reloaded.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, 'a newer copy from another tab')
      return Promise.reject(new Error('not opened'))
    })

    await reloaded.restore()

    expect(reloaded.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe('a newer copy from another tab')
  })
})

describe('a restore that fails', () => {
  /** An entry for the first user and key number, sealing this text as the cache it holds */
  async function entryHolding(text: string) {
    const key = await importSavedCopyKey(savedCopySession().saved_copy_key!)
    const entry = {
      shape: '14',
      userId: USER_A,
      keyNumber: 0,
      savedAt: Date.now(),
      ...(await sealSavedCopy(key, text)),
    }
    sealing = []
    return JSON.stringify(entry)
  }

  it('drops a key that is no key without throwing, and removes the copy it can not open', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: await entryHolding('{"queries":[]}') })

    dropSavedCopyKey()
    expect(() =>
      takeSavedCopyKey({ user: { id: USER_A }, saved_copy_key: '!!! not a key', saved_copy_key_version: 0 }),
    ).not.toThrow()
    await expect(page.restore()).resolves.toBeUndefined()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('removes a copy that opens but is no cache, and settles', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: await entryHolding('{"queries":5}') })

    await expect(page.restore()).resolves.toBeUndefined()

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
    expect(page.client.getQueryCache().getAll()).toEqual([])
  })
})

describe('removing a copy in the old form as the app starts', () => {
  it('removes a plain-text copy, and text that is no entry, with no key held, and keeps a copy that is an entry', async () => {
    const stored = await savedCopyOf()
    const entry = stored[QUERY_CACHE_STORAGE_KEY]
    const page = loadPage(
      { [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: OLD_PLAIN_TEXT_COPY },
      { session: WITHOUT_KEY },
    )

    removeUnreadableSavedCopy()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()

    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, 'not json at all')
    removeUnreadableSavedCopy()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()

    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, entry)
    removeUnreadableSavedCopy()
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(entry)
  })
})

describe('what the saved copy keeps of the last check', () => {
  const RECORD = {
    answer: {
      personalChangedAt: '2026-05-01T10:00:00.000Z',
      sharedChangedAt: null,
      calculationDateToken: 'secret-date-token',
      foreignCurrenciesToken: 'secret-currency-token',
      serverVersion: '1.2.3',
    },
    observedAt: 1_700_000_000_000,
    ratesDigest: 'secret-rates-digest',
  }

  it('keeps the answer only inside the ciphertext, the time beside it, and gives both back to a reload', async () => {
    const saving = loadPage({ [SESSION_KEY]: USER_A })
    saving.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    setCheckRecord(RECORD)
    await runTimedSave()

    const storedText = saving.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)!
    expect(storedText).not.toContain('secret-date-token')
    expect(storedText).not.toContain('secret-currency-token')
    expect(storedText).not.toContain('secret-rates-digest')
    expect(readStoredEntry(saving)).toMatchObject({ observedAt: RECORD.observedAt })
    expect(readEntryObservedAt(storedText)).toBe(RECORD.observedAt)

    setCheckRecord(null, { notify: false })
    const reloaded = loadPage(Object.fromEntries(saving.localStorage.items))
    await reloaded.restore()

    expect(getCheckRecord()).toEqual(RECORD)
    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }])
  })

  it('gives back a record whose answer about other currencies is null, as it is while they are allowed', async () => {
    const record = { ...RECORD, answer: { ...RECORD.answer, foreignCurrenciesToken: null } }
    const saving = loadPage({ [SESSION_KEY]: USER_A })
    saving.client.setQueryData(['accounts'], [{ id: 'first-user-account' }])
    setCheckRecord(record)
    await runTimedSave()

    setCheckRecord(null, { notify: false })
    const reloaded = loadPage(Object.fromEntries(saving.localStorage.items))
    await reloaded.restore()

    expect(getCheckRecord()).toEqual(record)
  })

  it('writes the entry again when the record changes with no query changed, which tells the other tabs', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    page.client.setQueryData(['accounts'], [])
    await runTimedSave()
    expect(readEntryObservedAt(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY))).toBeNull()

    setCheckRecord(RECORD)
    await runTimedSave()
    expect(readEntryObservedAt(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY))).toBe(RECORD.observedAt)

    setCheckRecord({ ...RECORD, observedAt: RECORD.observedAt + 1 })
    await runTimedSave()
    expect(readEntryObservedAt(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY))).toBe(RECORD.observedAt + 1)
  })

  it('restores an entry that holds no record, such as one an older version saved, with none', async () => {
    const stored = await savedCopyOf()

    const reloaded = loadPage(stored)
    await reloaded.restore()

    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }])
    expect(getCheckRecord()).toBeNull()
  })

  it('forgets the record with the saved copy', () => {
    loadPage({ [SESSION_KEY]: USER_A })
    setCheckRecord(RECORD)

    discardSavedCopy()

    expect(getCheckRecord()).toBeNull()
  })

  it('forgets the record when a new session starts, so the next user is not matched against the last', () => {
    const page = loadPage({ [SESSION_KEY]: USER_A })
    setCheckRecord(RECORD)

    clearUserScopedCache(page.client)

    expect(getCheckRecord()).toBeNull()
  })

  it.each([
    ['a check with no time beside it', (check: unknown) => ({ check, observedAt: undefined })],
    ['a time with no check beside it', () => ({ check: null, observedAt: RECORD.observedAt })],
    [
      'a check with a field of the wrong kind',
      (check: Record<string, unknown>) => ({
        check: { ...check, answer: { ...(check.answer as object), serverVersion: 3 } },
        observedAt: RECORD.observedAt,
      }),
    ],
    [
      'a check with no answer about other currencies',
      (check: Record<string, unknown>) => ({
        check: { ...check, answer: { ...(check.answer as object), foreignCurrenciesToken: undefined } },
        observedAt: RECORD.observedAt,
      }),
    ],
  ])(
    'restores the answers but no record from an entry with %s, so the first check fetches everything',
    async (_name, build) => {
      const session = savedCopySession()
      const { check, observedAt } = build({ answer: RECORD.answer, ratesDigest: RECORD.ratesDigest } as never)
      const sealed = await sealSavedCopy(
        await importSavedCopyKey(session.saved_copy_key!),
        JSON.stringify({
          queries: [{ queryKey: ['accounts'], queryHash: '["accounts"]', state: { data: [{ id: 'kept' }] } }],
          mutations: [],
          check,
        }),
      )
      const entry = {
        shape: '14',
        userId: USER_A,
        keyNumber: 0,
        savedAt: Date.now(),
        ...(observedAt === undefined ? {} : { observedAt }),
        ...sealed,
      }

      const reloaded = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: JSON.stringify(entry) })
      await reloaded.restore()

      expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'kept' }])
      expect(getCheckRecord()).toBeNull()
    },
  )
})
