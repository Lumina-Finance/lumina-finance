// Which of the browser's stores a value lives in: local storage outlives the tab, session storage
// lasts only as long as it
type StorageArea = 'local' | 'session'

/**
 * Opens one of the browser's stores, or null where the browser refuses access to it, as one set to
 * block all site data does. Even reading `window.localStorage` throws there
 */
function openStorage(area: StorageArea): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Reads a saved value, or null when there is none or the browser refuses access to its storage, so a
 * browser that blocks storage runs the app as it would on a first visit
 */
export function readStoredValue(key: string, area: StorageArea = 'local'): string | null {
  return openStorage(area)?.getItem(key) ?? null
}

/**
 * Saves a value, reporting whether it was saved. It isn't where the browser refuses access to its
 * storage or the store is full
 */
export function writeStoredValue(key: string, value: string, area: StorageArea = 'local'): boolean {
  const storage = openStorage(area)
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/**
 * Removes a saved value, doing nothing where the browser refuses access to its storage
 */
export function removeStoredValue(key: string, area: StorageArea = 'local'): void {
  openStorage(area)?.removeItem(key)
}
