import { useCallback, useEffect, useState, type RefObject } from 'react'
import {
  DEFAULT_DROPDOWN_LIST_POSITION,
  getDropdownListPosition,
  type DropdownListPosition,
} from '../dropdownPosition'

interface UseDropdownPositionParams {
  open: boolean
  searchable: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
}

interface UseDropdownPositionResult {
  listPosition: DropdownListPosition
  updateListPosition: () => void
}

/**
 * Reads the visual viewport when available so mobile browser chrome does not push the menu off-screen
 */
function getViewport(): {
  height: number
  offsetLeft: number
  offsetTop: number
  width: number
} {
  const visualViewport = window.visualViewport

  return {
    height: visualViewport?.height ?? window.innerHeight,
    offsetLeft: visualViewport?.offsetLeft ?? 0,
    offsetTop: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? window.innerWidth,
  }
}

/**
 * Tracks the floating dropdown menu position against the trigger and visual viewport
 */
export function useDropdownPosition({
  open,
  searchable,
  triggerRef,
}: UseDropdownPositionParams): UseDropdownPositionResult {
  const [listPosition, setListPosition] = useState(DEFAULT_DROPDOWN_LIST_POSITION)

  const updateListPosition = useCallback(() => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    setListPosition(getDropdownListPosition({
      anchorRect: rect,
      searchable,
      viewport: getViewport(),
    }))
  }, [searchable, triggerRef])

  useEffect(() => {
    if (!open) return

    let frame = 0
    const updateOnFrame = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateListPosition)
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
  }, [open, updateListPosition])

  return { listPosition, updateListPosition }
}
