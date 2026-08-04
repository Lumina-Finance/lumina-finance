import type { ReactNode, RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { joinClassNames } from '@/utils/classNames'
import { DROPDOWN_PRESS_SCALE, DROPDOWN_SPRING } from './motion'
import type { DropdownBoxPosition } from './position'

interface DropdownBoxProps {
  boxRef: RefObject<HTMLDivElement | null>
  children: ReactNode
  disabled: boolean
  hasError: boolean
  open: boolean

  /**
   * Whether the box holds the placement it opened with
   *
   * Stays true through the collapse, so a box that grew upward does not drop back to its slot on the
   * closing frame and play the rest of the collapse on the other side of the head.
   */
  placed: boolean

  position: DropdownBoxPosition
}

// Above both modal levels and the mobile filter sheet, matching the level the date picker already
// takes so a menu and a calendar opened from the same form agree on which sits in front
const DROPDOWN_OPEN_Z_INDEX = 110

/**
 * Renders the one box that holds the head and the list, and grows around them as it opens
 *
 * Closed, it sits absolutely inside its own wrapper, which costs nothing and keeps it in the page.
 * Open, the same element switches to fixed at the head's measured position, so it can grow past a
 * scrolling table or a modal body without being cut off. Switching only the positioning means the
 * head is never remounted, so focus, its id and the modal's own Tab handling carry straight through.
 *
 * It is not portalled: a modal decides whether focus is still inside it, and this drop-down decides
 * whether a press was outside it, by asking whether the element is a descendant. That costs one
 * constraint: no ancestor may carry a backdrop filter, a filter or a settled transform, any of which
 * would make itself the box these viewport coordinates are measured from.
 */
export function DropdownBox({
  boxRef,
  children,
  disabled,
  hasError,
  open,
  placed,
  position,
}: DropdownBoxProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      ref={boxRef}
      className={joinClassNames(
        'app-dropdown-glass',
        open && 'app-dropdown-glass-open',
        placed && position.openAbove && 'app-dropdown-glass-up',
        hasError && 'app-dropdown-glass-error',
        disabled && 'app-dropdown-glass-disabled',
      )}
      style={placed
        ? {
          position: 'fixed',
          // Pinned by whichever of the head's own edges the list grows away from, so the head does
          // not move by a pixel as the box opens around it
          bottom: position.openAbove ? position.bottom : undefined,
          top: position.openAbove ? undefined : position.top,
          left: position.left,
          width: position.width,
          maxHeight: position.boxMaxHeight,
          zIndex: DROPDOWN_OPEN_Z_INDEX,
        }
        : { position: 'absolute', top: 0, left: 0, right: 0 }}
      // Sinks under a press and springs back when it is let go. Suppressed once open, where sinking
      // a full-height list reads as the box collapsing early rather than as a control being pressed
      whileTap={open || disabled || shouldReduceMotion ? undefined : { scale: DROPDOWN_PRESS_SCALE }}
      transition={DROPDOWN_SPRING}
    >
      {placed && (
        <div
          aria-hidden
          className="app-dropdown-backdrop"
          // Given the box's full height straight away and anchored to the edge the box grows away
          // from, so it holds still while the box opens around it
          style={{
            height: position.boxMaxHeight,
            bottom: position.openAbove ? 0 : undefined,
            top: position.openAbove ? undefined : 0,
          }}
        />
      )}
      {children}
    </motion.div>
  )
}
