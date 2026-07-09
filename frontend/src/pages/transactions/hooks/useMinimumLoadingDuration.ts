import { useEffect, useRef, useState } from 'react'

/**
 * Keeps a loading flag raised for a minimum duration once it turns on, so a fast pull still shows its
 * loading state long enough to read rather than flashing on and off
 */
export function useMinimumLoadingDuration(active: boolean, minDurationMs: number): boolean {
  const [heldPastActive, setHeldPastActive] = useState(false)
  const activeSinceRef = useRef(0)

  useEffect(() => {
    if (active) {
      activeSinceRef.current = Date.now()
      // Turn the hold on through a timer so the effect never sets state synchronously
      if (!heldPastActive) {
        const raise = window.setTimeout(() => setHeldPastActive(true), 0)
        return () => window.clearTimeout(raise)
      }
      return
    }

    const remaining = Math.max(minDurationMs - (Date.now() - activeSinceRef.current), 0)
    const release = window.setTimeout(() => setHeldPastActive(false), remaining)
    return () => window.clearTimeout(release)
  }, [active, minDurationMs, heldPastActive])

  return active || heldPastActive
}
