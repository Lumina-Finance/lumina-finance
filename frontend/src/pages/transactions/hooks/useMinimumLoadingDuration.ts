import { useEffect, useRef, useState } from 'react'

/**
 * Keeps a loading flag raised for a minimum duration once it turns on, so a fast pull still shows its
 * loading state long enough to read rather than flashing on and off
 */
export function useMinimumLoadingDuration(active: boolean, minDurationMs: number): boolean {
  const [held, setHeld] = useState(active)
  const startRef = useRef<number | null>(active ? performance.now() : null)
  const wasActiveRef = useRef(active)

  useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = active

    if (active) {
      // A fresh pull resets the floor so each one is held for the full minimum
      if (!wasActive || startRef.current === null) startRef.current = performance.now()
      setHeld(true)
      return
    }

    if (startRef.current === null) {
      setHeld(false)
      return
    }

    const remaining = minDurationMs - (performance.now() - startRef.current)
    if (remaining <= 0) {
      startRef.current = null
      setHeld(false)
      return
    }

    const timer = window.setTimeout(() => {
      startRef.current = null
      setHeld(false)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [active, minDurationMs])

  return held
}
