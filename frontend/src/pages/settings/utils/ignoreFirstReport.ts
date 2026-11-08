/**
 * Wraps an observer's callback so that it ignores the first report
 *
 * A ResizeObserver reports once as it starts observing, before anything has changed. A scroll the
 * callback then starts without easing would cancel the smooth one that has only just begun
 */
export function ignoreFirstReport(callback: () => void): () => void {
  let isFirst = true
  return () => {
    if (isFirst) {
      isFirst = false
      return
    }
    callback()
  }
}
