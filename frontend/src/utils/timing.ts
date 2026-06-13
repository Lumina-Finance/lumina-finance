/**
 * Resolves after a fixed delay for minimum loading and feedback states
 */
export function waitForMilliseconds(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
