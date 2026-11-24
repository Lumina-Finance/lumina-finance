import {
  defaultShouldDehydrateQuery,
  dehydrate,
  hydrate,
  matchQuery,
  type DehydratedState,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from '@tanstack/react-query'
import { SESSION_KEY } from '@/api/auth/session'
import type { AuthResponse } from '@/api/auth/types'
import { getCheckRecord, setCheckRecord, subscribeToCheckRecord, type SavedCheck } from '@/api/cache/cacheCheck'
import { authKeys, twoFactorKeys } from '@/api/cache/queryKeys'
import { importSavedCopyKey, openSavedCopy, sealSavedCopy, type SealedCopy } from '@/api/cache/savedCopyCipher'
import { hasUncacheableFxStatus } from '@/api/shared/fxCache'
import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

// The local storage key holding the saved query cache, one copy shared by every tab
export const QUERY_CACHE_STORAGE_KEY = 'lumina:query-cache'

// When this tab loaded the app. Told apart from a restored entry by when its data was fetched, since a
// restored entry keeps the time of the visit that saved it
export const TAB_OPENED_AT = Date.now()

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

// The wait between timed saves, so a burst of cache changes writes once
const TIMED_SAVE_INTERVAL_MS = 1000

// Throws away every persisted entry whenever a stored response changes shape, so the app cannot
// restore a payload whose fields the code then looks for and fails to find. Persisted data
// outlives a deploy by up to six months and a fresh one is not refetched while it is still
// within its stale window, so without this the first render after such a change draws a card from
// fields that are no longer there. Bump it on any shape change. Version 1 is the account spending
// breakdown carrying a total per card in place of one shared figure. Version 2 adds the caller's
// write capability to every account response. Version 3 sends the amounts behind the Insights
// percentages in place of percentages, which changes the period glance and the category and merchant rows.
// Version 4 adds the refund links every transaction response carries. Version 5 adds the earlier-period
// sums and counts behind the spending comparison's average. Version 6 adds the bank source every
// transaction response carries. Version 7 adds the date range import every bank link carries. Version 8
// adds the bank's note and merchant to the bank values every review item and bank source carries. Version 9
// adds the provider, its name, and the bank's note and merchant to every bank hold. Version 10 lists only
// each budget's latest period, and keeps categories in a budget's spending history for its latest 12
// periods only. Version 11 adds the reason every FX status and transaction row gives for amounts left out
// of a total because converting them is refused. Version 12 adds the profile deletion wait every linked
// sign-in list carries
const PERSISTED_CACHE_SHAPE = '12'

/**
 * What local storage holds: the saved cache sealed under the user's key, and in plain text only what
 * a load needs to decide whether to open it
 *
 * The user id is already in plain text in the session flag. Nothing of the user's data is outside
 * the ciphertext, the last check's answer included. `observedAt` is the one time of it outside, so
 * another tab hearing of a write can tell from the header alone whether a check found a difference
 */
type SavedEntry = SealedCopy & {
  shape: string
  userId: string
  keyNumber: number
  savedAt: number
  observedAt?: number
}

// What the sealed text holds beside the dehydrated queries
type SavedState = DehydratedState & { check?: SavedCheck | null }

/** The key a signed-in tab seals its saved copy with, held in memory only */
type SessionKey = {
  userId: string
  number: number
  key: Promise<CryptoKey>
}

/**
 * Persists successful query data while leaving failed FX responses, the authenticator setup
 * response and reset link checks out of the saved copy
 *
 * The setup response holds a new authenticator secret and its setup link, which would otherwise be
 * saved and left there by a tab closed mid-setup. Setup mints a fresh secret each time it opens, so
 * a reload loses nothing by not restoring it. A reset link check is keyed by the emailed reset
 * token, so saving one would store a working reset link
 */
function shouldDehydrateQuery(query: Query) {
  return (
    defaultShouldDehydrateQuery(query) &&
    !hasUncacheableFxStatus(query.state.data) &&
    !matchQuery({ queryKey: twoFactorKeys.setup(), exact: true }, query) &&
    !matchQuery({ queryKey: authKeys.resetLinks() }, query)
  )
}

// Query data only. A request held while offline would otherwise be saved with what it sends, such as
// both passwords of a password change, and could never be sent after a reload
const dehydrateOptions = { shouldDehydrateQuery, shouldDehydrateMutation: () => false }

// The query cache events that change what a save writes
const SAVED_CACHE_EVENT_TYPES = new Set<QueryCacheNotifyEvent['type']>(['added', 'removed', 'updated'])

// The user this tab is signed in as, from its own sign-in state, and the key it was given with its session
let tabUserId: string | null = null
let sessionKey: SessionKey | null = null

// Cache changes since saving started, and the count the stored copy reflects
let changeCount = 0
let savedChangeCount = 0

// Each save takes the next number when it starts, and a write older than the newest one already stored
// is dropped, since encryption of a later save can finish before an earlier one's
let lastSequence = 0
let storedSequence = 0

// The change count below which a finished save is dropped. Leaving the page, or a newer save failing,
// removes the stored copy for lacking the latest changes, and a save still encrypting from before
// that would otherwise write its older copy back
let staleBelowChanges = 0

// When the last save started
let lastSavedAt = 0

let isSavingStopped = false

/**
 * Takes the key a session arrived with, the one every later save is sealed with and every load opened
 * with, or none when the response carries none
 *
 * The server derives the key from the user and the key number, so the same pair is the same key and
 * taking it again changes nothing. A different key number means the server ended the user's other
 * sessions, so the stored copy, sealed under the old key, is removed when this tab held that key. A tab
 * that held none leaves it to the next load. That load finds the number differs. Every place that takes a
 * session calls this, and it never throws, since a session already exists when it runs
 */
export function takeSavedCopyKey(
  session: Pick<AuthResponse, 'saved_copy_key' | 'saved_copy_key_version'> & { user: Pick<AuthResponse['user'], 'id'> },
) {
  const encoded = session.saved_copy_key
  const number = session.saved_copy_key_version
  if (encoded === undefined || number === undefined) {
    dropSavedCopyKey()
    return
  }
  const userId = session.user.id
  if (sessionKey?.userId === userId && sessionKey.number === number) return
  if (sessionKey !== null && sessionKey.number !== number) removeStoredValue(QUERY_CACHE_STORAGE_KEY)

  const key = importSavedCopyKey(encoded)
  // Text that isn't a key rejects this promise, so each save and load awaiting it fails. Nothing
  // else awaits it, so the rejection is no failure of its own
  key.catch(() => {})
  sessionKey = { userId, number, key }
}

/**
 * Forgets the key, so nothing is saved until a session brings another. The stored copy stays, as it
 * belongs to whoever the session flag names now
 */
export function dropSavedCopyKey() {
  sessionKey = null
}

/**
 * Removes the saved copy and forgets the key, as signing out or losing the session does
 */
export function discardSavedCopy() {
  dropSavedCopyKey()
  setCheckRecord(null, { notify: false })
  removeStoredValue(QUERY_CACHE_STORAGE_KEY)
}

/**
 * Records the user this tab is signed in as, or null once it signs out. Only a tab with a user saves
 */
export function setQueryCacheUser(userId: string | null) {
  tabUserId = userId
}

function isSavedEntry(value: unknown): value is SavedEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.shape === 'string' &&
    typeof entry.userId === 'string' &&
    typeof entry.keyNumber === 'number' &&
    typeof entry.savedAt === 'number' &&
    (entry.observedAt === undefined || typeof entry.observedAt === 'number') &&
    typeof entry.nonce === 'string' &&
    typeof entry.ciphertext === 'string'
  )
}

/** The stored entry, or null for no entry, text that isn't JSON or the older plain-text form */
function parseSavedEntry(stored: string): SavedEntry | null {
  try {
    const parsed: unknown = JSON.parse(stored)
    return isSavedEntry(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * When the last check found a difference, as the stored entry in `stored` records, or null for no
 * entry, one that isn't readable or one saved before any check answered
 *
 * Another tab reads it from a storage event to tell a write that records a new observation from one
 * that only saves more answers
 */
export function readEntryObservedAt(stored: string | null) {
  if (stored === null) return null
  return parseSavedEntry(stored)?.observedAt ?? null
}

function isSavedCheck(value: unknown): value is SavedCheck {
  if (typeof value !== 'object' || value === null) return false
  const { answer, ratesDigest } = value as Record<string, unknown>
  if (typeof answer !== 'object' || answer === null) return false
  const fields = answer as Record<string, unknown>
  return (
    (fields.personalChangedAt === null || typeof fields.personalChangedAt === 'string') &&
    (fields.sharedChangedAt === null || typeof fields.sharedChangedAt === 'string') &&
    typeof fields.calculationDateToken === 'string' &&
    (fields.foreignCurrenciesToken === null || typeof fields.foreignCurrenciesToken === 'string') &&
    typeof fields.serverVersion === 'string' &&
    (ratesDigest === null || typeof ratesDigest === 'string')
  )
}

/**
 * Restores the saved cache for the user whose session has just been renewed, and settles whether or
 * not there is anything to restore
 *
 * Nothing is opened but with the key the renewal returned. A copy that can't be opened by it, saved
 * under another key number, for another user, too long ago, in another shape or in the plain-text form
 * older versions wrote is removed unread, since it would otherwise be tried on every load
 *
 * Never throws, so a restore that fails for any reason still settles
 *
 * @param queryClient - The cache to restore into
 * @param userId - The user the renewal returned
 */
export async function restoreSavedQueryCache(queryClient: QueryClient, userId: string) {
  const stored = readStoredValue(QUERY_CACHE_STORAGE_KEY)
  if (stored === null) return

  const entry = parseSavedEntry(stored)
  const key = sessionKey
  const isOpenable =
    entry !== null &&
    key !== null &&
    entry.shape === PERSISTED_CACHE_SHAPE &&
    entry.userId === userId &&
    entry.keyNumber === key.number &&
    Date.now() - entry.savedAt <= SIX_MONTHS_MS
  if (!isOpenable) {
    removeStoredValue(QUERY_CACHE_STORAGE_KEY)
    return
  }

  try {
    const state = JSON.parse(await openSavedCopy(await key.key, entry)) as SavedState
    hydrate(queryClient, state)

    // The record is the entry's alone, so one without both its parts is none, and the first check
    // after it fetches everything again
    if (isSavedCheck(state.check) && entry.observedAt !== undefined) {
      setCheckRecord({ ...state.check, observedAt: entry.observedAt }, { notify: false })
    }
  } catch {
    // Another tab may have saved its own copy while this one was opened, and that one stays
    if (readStoredValue(QUERY_CACHE_STORAGE_KEY) === stored) removeStoredValue(QUERY_CACHE_STORAGE_KEY)
  }
}

/**
 * Removes a stored copy in the plain-text form earlier versions wrote, or any other that is no entry,
 * as the app starts. It needs no key, so it clears such a copy on every load, including one whose
 * session renewal is refused or can't be answered
 */
export function removeUnreadableSavedCopy() {
  const stored = readStoredValue(QUERY_CACHE_STORAGE_KEY)
  if (stored !== null && parseSavedEntry(stored) === null) removeStoredValue(QUERY_CACHE_STORAGE_KEY)
}

/**
 * Writes a sealed copy, unless what it was sealed for has changed since it was started
 *
 * The write is only allowed while the session flag names the user and the tab still holds the key it
 * sealed with. The flag is gone once the session ends, and names someone else once another person
 * signs in in another tab, so a tab still holding the earlier user's data can't save it where that
 * other person's next load would restore it. Encryption takes time, so all of this is read now,
 * after it, rather than when the save started
 */
function writeSavedCopy(entry: SavedEntry, sequence: number, changes: number, key: SessionKey) {
  if (isSavingStopped) return
  const sessionUserId = readStoredValue(SESSION_KEY)
  if (sessionUserId === null) {
    removeStoredValue(QUERY_CACHE_STORAGE_KEY)
    return
  }
  if (entry.userId !== sessionUserId || entry.userId !== tabUserId || key !== sessionKey) return
  if (sequence < storedSequence || changes < staleBelowChanges) return

  if (writeStoredValue(QUERY_CACHE_STORAGE_KEY, JSON.stringify(entry))) {
    storedSequence = sequence
    savedChangeCount = changes
  } else {
    // Storage is full, so the older copy left behind would be restored as fresh on the next load.
    // Without it that load starts empty and fetches everything
    removeStoredValue(QUERY_CACHE_STORAGE_KEY)
  }
}

/**
 * Starts sealing and writing this tab's copy of the cache, when it changed since the stored copy was written
 *
 * Every tab shares the one saved copy, so a tab writes only when its cache changed since it last
 * wrote. An unchanged tab left in the background would otherwise put its older copy over a newer one
 * another tab saved, and the next load would restore it as fresh. The cache is read now, so the copy
 * reflects every change up to this moment however long the encryption takes
 */
async function saveQueryCache(queryClient: QueryClient) {
  const key = sessionKey
  const userId = tabUserId
  if (isSavingStopped || key === null || userId === null || changeCount === savedChangeCount) return

  const sequence = ++lastSequence
  const changes = changeCount
  const savedAt = Date.now()
  lastSavedAt = savedAt
  const record = getCheckRecord()
  const check: SavedCheck | null = record && { answer: record.answer, ratesDigest: record.ratesDigest }
  const state = JSON.stringify({ ...dehydrate(queryClient, dehydrateOptions), check } satisfies SavedState)
  try {
    const sealed = await sealSavedCopy(await key.key, state)
    writeSavedCopy(
      {
        shape: PERSISTED_CACHE_SHAPE,
        userId,
        keyNumber: key.number,
        savedAt,
        ...(record && { observedAt: record.observedAt }),
        ...sealed,
      },
      sequence,
      changes,
      key,
    )
  } catch {
    // Without a copy that reflects the cache, the older one left behind would be restored as current,
    // and a save from before this one that is still encrypting must not write it back
    staleBelowChanges = Math.max(staleBelowChanges, changes)
    removeStoredValue(QUERY_CACHE_STORAGE_KEY)
  }
}

/**
 * Saves the query cache from now on, as it changes and whenever the page is hidden or left, and
 * returns a function that stops that
 *
 * Called once the restore has settled, so a save can't put an empty cache over the stored copy while
 * it waits to be restored. A change saves at most once a second. Hiding the page starts a save at
 * once, and never removes the stored copy, since the page may be shown again. Encryption is
 * asynchronous, so leaving the page can't wait for it: a copy that doesn't reflect every change is
 * removed then, so an older one is never restored as current
 */
export function startSavingQueryCache(queryClient: QueryClient) {
  // The restore has just made the cache and the saved copy the same
  changeCount = 0
  savedChangeCount = 0
  lastSequence = 0
  storedSequence = 0
  staleBelowChanges = 0
  lastSavedAt = 0

  let timer: ReturnType<typeof setTimeout> | null = null
  const scheduleTimedSave = () => {
    if (timer !== null) return
    timer = setTimeout(
      () => {
        timer = null
        // A timer can wake early, and a clock held still never lets the interval pass
        if (Date.now() - lastSavedAt < TIMED_SAVE_INTERVAL_MS) scheduleTimedSave()
        else void saveQueryCache(queryClient)
      },
      Math.max(0, lastSavedAt + TIMED_SAVE_INTERVAL_MS - Date.now()),
    )
  }

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (!SAVED_CACHE_EVENT_TYPES.has(event.type)) return
    changeCount += 1
    scheduleTimedSave()
  })
  // A new check record is saved like any change, so a reload or another tab finds what this one last saw
  const unsubscribeRecord = subscribeToCheckRecord(() => {
    changeCount += 1
    scheduleTimedSave()
  })
  const onPageHide = () => {
    if (sessionKey !== null && tabUserId !== null && changeCount !== savedChangeCount) {
      staleBelowChanges = changeCount
      removeStoredValue(QUERY_CACHE_STORAGE_KEY)
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void saveQueryCache(queryClient)
  }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    unsubscribe()
    unsubscribeRecord()
    if (timer !== null) clearTimeout(timer)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/**
 * Stops every save of the query cache, so a reload after clearing storage starts from nothing
 */
export function stopSavingQueryCache() {
  isSavingStopped = true
}
