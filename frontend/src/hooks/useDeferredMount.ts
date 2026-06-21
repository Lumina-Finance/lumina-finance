import { useEffect, useState, startTransition } from 'react'

/**
 * Holds an expensive subtree back until after the first paint so the surrounding interactive
 * controls commit and respond to input first. Safari cannot yield to a pending tap mid-commit the
 * way Chromium can through isInputPending, so deferring a heavy chart mount by a frame keeps the
 * toolbar and menu tappable right after the page loads. Returns false until the deferred frame runs
 */
export function useDeferredMount(): boolean {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // The second frame guarantees the light first paint lands before the heavy subtree renders
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        startTransition(() => setMounted(true))
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [])

  return mounted
}
