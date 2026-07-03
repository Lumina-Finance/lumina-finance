/** Minimum visible loading time shared across auth actions so a quick request does not flash */
export const AUTH_LOADING_MIN_MS = 1000

/** Minimum visible loading time for two-factor management actions so a quick request does not flash */
export const MFA_LOADING_MIN_MS = 800

/**
 * Resolves after a fixed delay for minimum loading and feedback states
 */
export function waitForMilliseconds(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * Waits out whatever remains of the minimum loading time since a start timestamp
 */
export async function delayToMinimum(startMs: number, minimumMs: number = AUTH_LOADING_MIN_MS): Promise<void> {
  const elapsed = Date.now() - startMs
  if (elapsed < minimumMs) {
    await waitForMilliseconds(minimumMs - elapsed)
  }
}

/**
 * Runs an action but holds its settlement for at least the minimum loading time, covering both success
 * and failure so a quick management mutation does not flash its spinner
 */
export async function withMinDelay<T>(action: () => Promise<T>, minimumMs: number = MFA_LOADING_MIN_MS): Promise<T> {
  const start = Date.now()
  try {
    return await action()
  } finally {
    await delayToMinimum(start, minimumMs)
  }
}
