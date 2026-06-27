/** Minimum visible loading time shared across auth actions so a quick request does not flash */
export const AUTH_LOADING_MIN_MS = 1000

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
