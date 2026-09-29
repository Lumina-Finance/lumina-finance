import type { JournalImportSource } from '@/api/provider-imports'

/** A provider import save that was sent and never answered, with what its summary needs */
export interface UnconfirmedImportSave {
  runId: string

  /** Rows the import left out, since the rows themselves are not kept past the page */
  skippedCount: number

  /** Milliseconds since the epoch when the save was last sent, which orders several */
  recordedAt: number
}

/**
 * Where the browser keeps the saves it never heard back about, so leaving the page, reloading it
 * or closing the tab still blocks importing the same export a second time
 *
 * Each save is kept on its own, so a second tab importing from the same app neither overwrites
 * nor clears the first tab's. There is no expiry here: the server stops saving a run it has held
 * uncommitted for a day, so asking it about a kept save always settles it once it can be reached
 */
export interface UnconfirmedImportSaveStore {
  /** The save sent longest ago, which is the one to settle first */
  readOldest: () => UnconfirmedImportSave | null
  /** Keeps a save, returning false where the browser refused to, so the page knows it alone holds it */
  record: (save: Omit<UnconfirmedImportSave, 'recordedAt'>) => boolean
  clear: (runId: string) => void
}

/**
 * Names the saves of one user's imports from one app, so another account signed in on the same
 * browser neither sees nor clears them
 */
export function getUnconfirmedImportSavePrefix(userId: string, source: JournalImportSource) {
  return `lumina:imports:unconfirmedSave:${userId}:${source}:`
}

function isUnconfirmedImportSave(value: unknown): value is UnconfirmedImportSave {
  if (typeof value !== 'object' || value === null) return false
  const save = value as Record<string, unknown>
  return typeof save.runId === 'string'
    && typeof save.skippedCount === 'number'
    && typeof save.recordedAt === 'number'
}

/**
 * Keeps the saves in the storage given, under the prefix given, treating storage the browser
 * refuses, such as in a private window, as holding nothing. A save it could not keep is
 * reported, since the page then holds the only record of it and must not offer a way to leave it
 *
 * @param now - Milliseconds since the epoch, which records when a save was sent
 */
export function createUnconfirmedImportSaveStore(
  storage: Storage | null,
  prefix: string,
  now: () => number,
): UnconfirmedImportSaveStore {
  const clear = (runId: string) => {
    try {
      storage?.removeItem(`${prefix}${runId}`)
    } catch {
      // Nothing to report: a save that cannot be removed could not have been read either
    }
  }

  const readAll = () => {
    if (!storage) return []
    const saves: UnconfirmedImportSave[] = []
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue
        let save: unknown = null
        try {
          save = JSON.parse(storage.getItem(key) ?? 'null')
        } catch {
          // Unreadable, so it is dropped below like any other record that is not a save
        }
        if (isUnconfirmedImportSave(save) && key === `${prefix}${save.runId}`) {
          saves.push(save)
        } else {
          storage.removeItem(key)
        }
      }
    } catch {
      return []
    }
    return saves
  }

  return {
    readOldest: () => readAll().sort((first, second) => first.recordedAt - second.recordedAt)[0] ?? null,
    record: (save) => {
      if (!storage) return false
      try {
        storage.setItem(`${prefix}${save.runId}`, JSON.stringify({ ...save, recordedAt: now() }))
        return true
      } catch {
        return false
      }
    },
    clear,
  }
}

/**
 * Returns the browser's local storage, or null where the browser refuses to hand it over, as some
 * do for a page whose site data is blocked
 */
export function getBrowserLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
