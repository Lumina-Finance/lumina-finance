import { useEffect, useRef, useState, type RefObject } from 'react'
import { BELOW_MOBILE_NAVIGATION_TOGGLE_ROOT_MARGIN } from '@/components/navigation/constants/data'

export type MobileSearchStuckState = {
  mobileSearchStickySentinelRef: RefObject<HTMLDivElement | null>
  mobileSearchStuck: boolean
}

/**
 * Tracks when the mobile search row has reached the fixed mobile navigation toggle pinned to the top-right
 * corner, so the search field leaves room for it before it passes under it and stays that wide once docked
 */
export function useMobileSearchStuck(): MobileSearchStuckState {
  const mobileSearchStickySentinelRef = useRef<HTMLDivElement>(null)
  const [mobileSearchStuck, setMobileSearchStuck] = useState(false)

  useEffect(() => {
    const sentinel = mobileSearchStickySentinelRef.current
    if (!sentinel) return undefined

    const mobileQuery = window.matchMedia('(max-width: 1049.98px)')
    let sentinelIntersecting = true

    /**
     * Combines viewport width and sentinel visibility so desktop wrapping never inherits mobile spacing
     */
    function updateStuck() {
      setMobileSearchStuck(mobileQuery.matches && !sentinelIntersecting)
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

  return { mobileSearchStickySentinelRef, mobileSearchStuck }
}
