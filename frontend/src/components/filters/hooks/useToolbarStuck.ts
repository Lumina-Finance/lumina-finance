import { useEffect, useRef, useState, type RefObject } from 'react'

// The toolbar docks 10px below the viewport top so the search field's own 10px of top padding lands
// its top on the navigation pane's 1.25rem (20px) top line rather than below it. Keep in sync with the
// top-2.5 sticky offset on the toolbar element
export const TOOLBAR_DOCK_OFFSET_PX = 10
export const DESKTOP_MEDIA_QUERY = '(min-width: 1050px)'

export type ToolbarStuckState = {
  toolbarStuckSentinelRef: RefObject<HTMLDivElement | null>
  isToolbarStuck: boolean
}

/**
 * Tracks when the desktop toolbar has pinned to the navigation pane's top line so its background can
 * extend upward and mask the list content scrolling through the gap above it
 */
export function useToolbarStuck(): ToolbarStuckState {
  const toolbarStuckSentinelRef = useRef<HTMLDivElement>(null)
  const [isToolbarStuck, setIsToolbarStuck] = useState(false)

  useEffect(() => {
    const sentinel = toolbarStuckSentinelRef.current
    if (!sentinel) return undefined

    const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY)
    let sentinelIntersecting = true

    /**
     * Combines viewport width and sentinel visibility so the upward mask only applies on desktop, where
     * the toolbar docks below the viewport edge
     */
    function updateStuck() {
      setIsToolbarStuck(desktopQuery.matches && !sentinelIntersecting)
    }

    // Shrinking the root's top edge by the nav offset makes the sentinel read as hidden exactly when
    // the toolbar reaches the pane's top line instead of when it touches the viewport edge
    const observer = new IntersectionObserver(
      ([entry]) => {
        sentinelIntersecting = entry.isIntersecting
        updateStuck()
      },
      { rootMargin: `-${TOOLBAR_DOCK_OFFSET_PX}px 0px 0px 0px`, threshold: 0 },
    )

    observer.observe(sentinel)
    desktopQuery.addEventListener('change', updateStuck)

    return () => {
      observer.disconnect()
      desktopQuery.removeEventListener('change', updateStuck)
    }
  }, [])

  return { toolbarStuckSentinelRef, isToolbarStuck }
}
