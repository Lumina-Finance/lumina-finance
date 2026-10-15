import { useEffect, useRef, useState, type RefObject } from 'react'
import { BELOW_MOBILE_NAVIGATION_TOGGLE_ROOT_MARGIN, MOBILE_NAVIGATION_QUERY } from '@/components/navigation/constants/data'

export type TopRowAtMenuButtonState = {
  topRowSentinelRef: RefObject<HTMLDivElement | null>
  isTopRowAtMenuButton: boolean
}

/**
 * Tracks when the toolbar's top row has reached the fixed mobile navigation toggle pinned to the top-right
 * corner, so the row leaves room for it before it passes under it and keeps that room once docked
 */
export function useTopRowAtMenuButton(): TopRowAtMenuButtonState {
  const topRowSentinelRef = useRef<HTMLDivElement>(null)
  const [isTopRowAtMenuButton, setIsTopRowAtMenuButton] = useState(false)

  useEffect(() => {
    const sentinel = topRowSentinelRef.current
    if (!sentinel) return undefined

    const mobileQuery = window.matchMedia(MOBILE_NAVIGATION_QUERY)
    let sentinelIntersecting = true

    /**
     * Combines viewport width and sentinel visibility so desktop wrapping never inherits mobile spacing
     */
    function updateStuck() {
      setIsTopRowAtMenuButton(mobileQuery.matches && !sentinelIntersecting)
    }

    // A busy page can hand over several changes at once, oldest first, so only the last one is current
    const observer = new IntersectionObserver(
      (entries) => {
        sentinelIntersecting = entries[entries.length - 1].isIntersecting
        updateStuck()
      },
      { threshold: 0, rootMargin: BELOW_MOBILE_NAVIGATION_TOGGLE_ROOT_MARGIN },
    )

    observer.observe(sentinel)
    mobileQuery.addEventListener('change', updateStuck)

    return () => {
      observer.disconnect()
      mobileQuery.removeEventListener('change', updateStuck)
    }
  }, [])

  return { topRowSentinelRef, isTopRowAtMenuButton }
}
