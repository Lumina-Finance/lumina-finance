import { useCallback, useEffect, useState, type RefObject } from 'react'
import {
  DEFAULT_DROPDOWN_BOX_POSITION,
  getDropdownBoxPosition,
  type DropdownBoxPosition,
  type DropdownViewport,
} from '@/components/dropdown/position'

interface UseDropdownPositionParams {
  open: boolean
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
  open,
  searchable,
  wrapperRef,
}: UseDropdownPositionParams): UseDropdownPositionResult {
  const [boxPosition, setBoxPosition] = useState(DEFAULT_DROPDOWN_BOX_POSITION)

  const updateBoxPosition = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const rect = wrapper.getBoundingClientRect()
    setBoxPosition(getDropdownBoxPosition({
      anchorRect: rect,
      headHeight: rect.height,
      searchable,
      viewport: getViewport(),
    }))
  }, [searchable, wrapperRef])

  useEffect(() => {
    if (!open) return

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
  }, [open, updateBoxPosition])

  return { boxPosition, updateBoxPosition }
}
