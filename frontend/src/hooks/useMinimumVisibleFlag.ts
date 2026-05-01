import { useEffect, useRef, useState } from 'react'

export function useMinimumVisibleFlag(active: boolean, minimumVisibleMs: number) {
  const [visible, setVisible] = useState(active)
  const visibleSinceRef = useRef(0)

  useEffect(() => {
    let timeoutId: number

    if (active) {
      visibleSinceRef.current = performance.now()
      timeoutId = window.setTimeout(() => setVisible(true), 0)
      return () => window.clearTimeout(timeoutId)
    }

    if (!visible) return undefined

    const elapsed = performance.now() - visibleSinceRef.current
    const remaining = Math.max(minimumVisibleMs - elapsed, 0)
    timeoutId = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(timeoutId)
  }, [active, minimumVisibleMs, visible])

  return visible
}
