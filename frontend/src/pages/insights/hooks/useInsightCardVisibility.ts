import { useEffect, useRef, useState } from 'react'

/**
 * Tracks whether an insight card is visible so expensive queries can stay disabled until needed
 */
export function useInsightCardVisibility() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    // Browsers without IntersectionObserver should load the card instead of leaving it disabled
    if (typeof IntersectionObserver === 'undefined') {
      const frameId = window.requestAnimationFrame(() => setIsVisible(true))
      return () => window.cancelAnimationFrame(frameId)
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting)
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, isVisible] as const
}
