import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

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
     * Uses the rendered toolbar height because desktop filters can wrap as labels change
     */
    function updateStickyOffset() {
      publishStickyOffset(Math.ceil(toolbarElement.getBoundingClientRect().height + DATE_HEADER_STICKY_GAP_PX))
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
