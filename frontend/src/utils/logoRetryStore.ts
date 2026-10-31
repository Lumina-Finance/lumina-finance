// How many times a logo may fail to load while the browser is online before it keeps its placeholder for
// the page's life, so an address that is genuinely gone is not fetched again and again
export const MAX_LOGO_FAILURES = 3

// How long a failed logo is left alone before a row that mounts draws it again, so a list that
// re-renders as it loads does not spend a logo's attempts before the connection could have returned
export const LOGO_RETRY_DELAY_MS = 5000

/**
 * Tracks the logos that failed to load, so every place drawing one shows its placeholder together and
 * draws the image again when asked to. Failures while offline are free, since the connection is the
 * likely cause, and a logo that fails online too often stays dropped
 */
export function createLogoRetryStore(isOnline: () => boolean, now: () => number = Date.now) {
  // Each dropped logo with the time it failed
  const dropped = new Map<string, number>()
  const failures = new Map<string, number>()
  const listeners = new Set<() => void>()

  const canRetry = (url: string) => (failures.get(url) ?? 0) < MAX_LOGO_FAILURES
  const notify = () => listeners.forEach((listener) => listener())

  return {
    isDropped: (url: string) => dropped.has(url),

    // Several images share a logo, so only the first error of a load counts as a failure
    fail(url: string) {
      if (dropped.has(url)) return
      dropped.set(url, now())
      if (isOnline()) failures.set(url, (failures.get(url) ?? 0) + 1)
      notify()
    },

    succeed(url: string) {
      failures.delete(url)
    },

    // For a row that mounts, which waits out the delay
    retry(url: string) {
      const failedAt = dropped.get(url)
      if (failedAt === undefined || !canRetry(url) || now() - failedAt < LOGO_RETRY_DELAY_MS) return
      dropped.delete(url)
      notify()
    },

    // For the connection returning or the page being shown again, which is reason enough to try at once
    retryAll() {
      const retried = [...dropped.keys()].filter(canRetry)
      if (retried.length === 0) return
      retried.forEach((url) => dropped.delete(url))
      notify()
    },

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
