import { useEffect, useRef, useState } from 'react'

/**
 * Tracks a visibility flag that mirrors `active` but stays true for at least `minimumVisibleMs` after
 * `active` turns false, so a brief state does not disappear before its enter or exit transition can
 * play
 *
 * Turning visible happens on the next tick rather than synchronously, so a caller can rely on the
 * flag's transition from false to true to drive a CSS animation
 */
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
