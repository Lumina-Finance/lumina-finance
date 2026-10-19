import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { DESKTOP_MEDIA_QUERY, TOOLBAR_DOCK_OFFSET_PX } from '@/components/filters/hooks/useToolbarStuck'

const DATE_HEADER_STICKY_GAP_PX = 4

/**
 * Publishes the toolbar height so transaction date headers can stick below it without overlap
 */
export function useToolbarStickyOffset(
  toolbarRef: RefObject<HTMLDivElement | null>,
  onStickyOffsetChange?: (offset: number) => void,
) {
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || !onStickyOffsetChange) return undefined
    const toolbarElement = toolbar
    const publishStickyOffset = onStickyOffsetChange

    /**
     * Uses the rendered toolbar height because desktop filters can wrap as labels change, and adds the
     * desktop dock offset so headers stick below the toolbar once it pins to the navigation pane line
     */
    function updateStickyOffset() {
      const dockOffset = window.matchMedia(DESKTOP_MEDIA_QUERY).matches ? TOOLBAR_DOCK_OFFSET_PX : 0
      publishStickyOffset(Math.ceil(toolbarElement.getBoundingClientRect().height) + DATE_HEADER_STICKY_GAP_PX + dockOffset)
    }

    updateStickyOffset()

    const resizeObserver = new ResizeObserver(updateStickyOffset)
    resizeObserver.observe(toolbarElement)
    window.addEventListener('resize', updateStickyOffset)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateStickyOffset)
    }
  }, [onStickyOffsetChange, toolbarRef])
}
