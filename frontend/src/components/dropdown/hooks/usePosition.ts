import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  DEFAULT_DROPDOWN_BOX_POSITION,
  getDropdownBoxPosition,
  type DropdownBoxDirection,
  type DropdownBoxPosition,
  type DropdownViewport,
} from '@/components/dropdown/position'

interface UseDropdownPositionParams {
  /** True for as long as the box is floating, which outlasts `open` by the length of the collapse */
  placed: boolean

  searchable: boolean

  /** The slot the control occupies in the page, held at the collapsed height while the box is open */
  wrapperRef: RefObject<HTMLDivElement | null>
}

interface UseDropdownPositionResult {
  boxPosition: DropdownBoxPosition
  updateBoxPosition: () => void
}

/**
 * Reads the visual viewport when available so mobile browser chrome does not push the box off-screen
 */
function getViewport(): DropdownViewport {
  const visualViewport = window.visualViewport

  return {
    height: visualViewport?.height ?? window.innerHeight,
    layoutHeight: window.innerHeight,
    // The page's own width rather than the window's, which counts the scrollbar gutter this app
    // keeps reserved. A fixed box placed by its right edge against the window would sit that far
    // to the left of where it belongs
    layoutWidth: document.documentElement.clientWidth,
    offsetLeft: visualViewport?.offsetLeft ?? 0,
    offsetTop: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? window.innerWidth,
  }
}

/**
 * Tracks where the open box sits against the slot it came from and the visible viewport
 *
 * Measured from the wrapper rather than from the box or the head inside it. Both of those move with
 * the box once it is open, so the box would be chasing its own position and would sit still while
 * the page scrolled underneath. The wrapper stays in the page and moves with it.
 */
export function useDropdownPosition({
  placed,
  searchable,
  wrapperRef,
}: UseDropdownPositionParams): UseDropdownPositionResult {
  const [boxPosition, setBoxPosition] = useState(DEFAULT_DROPDOWN_BOX_POSITION)

  // The way the box is currently growing, kept from the measurement that opened it and given back
  // to every measurement after it, so scrolling changes how much room the box has rather than which
  // side of the field it is on
  const heldDirection = useRef<DropdownBoxDirection | null>(null)

  const updateBoxPosition = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const rect = wrapper.getBoundingClientRect()
    const next = getDropdownBoxPosition({
      anchorRect: rect,
      headHeight: rect.height,
      held: heldDirection.current,
      searchable,
      viewport: getViewport(),
    })

    heldDirection.current = { openAbove: next.openAbove, openLeftward: next.openLeftward }
    setBoxPosition(next)
  }, [searchable, wrapperRef])

  useEffect(() => {
    // Kept up through the collapse as well. Stopping at the moment the list closes leaves a box that is
    // still floating welded to where the page was, while the slot it belongs to scrolls away underneath
    if (!placed) {
      // Let go of once the box is back in its slot, so the next opening chooses its own way again
      heldDirection.current = null
      return
    }

    let frame = 0
    const updateOnFrame = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateBoxPosition)
    }

    updateOnFrame()
    window.addEventListener('resize', updateOnFrame)
    window.addEventListener('scroll', updateOnFrame, true)
    window.visualViewport?.addEventListener('resize', updateOnFrame)
    window.visualViewport?.addEventListener('scroll', updateOnFrame)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateOnFrame)
      window.removeEventListener('scroll', updateOnFrame, true)
      window.visualViewport?.removeEventListener('resize', updateOnFrame)
      window.visualViewport?.removeEventListener('scroll', updateOnFrame)
    }
  }, [placed, updateBoxPosition])

  return { boxPosition, updateBoxPosition }
}
