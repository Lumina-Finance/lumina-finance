import { useEffect, useRef, useState, type RefObject } from 'react'

export type MobileSearchStuckState = {
  mobileSearchStickySentinelRef: RefObject<HTMLDivElement | null>
  mobileSearchStuck: boolean
}

/**
 * Tracks when the mobile search row has stuck to the viewport so the search field can leave room for
 * the fixed mobile navigation toggle pinned to the top-right corner
 */
export function useMobileSearchStuck(): MobileSearchStuckState {
  const mobileSearchStickySentinelRef = useRef<HTMLDivElement>(null)
  const [mobileSearchStuck, setMobileSearchStuck] = useState(false)

  useEffect(() => {
    const sentinel = mobileSearchStickySentinelRef.current
    if (!sentinel) return undefined

    const mobileQuery = window.matchMedia('(max-width: 1049px)')
    let sentinelIntersecting = true

    /**
     * Combines viewport width and sentinel visibility so desktop wrapping never inherits mobile spacing
     */
    function updateStuck() {
      setMobileSearchStuck(mobileQuery.matches && !sentinelIntersecting)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        sentinelIntersecting = entry.isIntersecting
        updateStuck()
      },
      { threshold: 0 },
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
