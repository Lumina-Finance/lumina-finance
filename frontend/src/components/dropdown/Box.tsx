import type { ReactNode, RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { joinClassNames } from '@/utils/classNames'
import { DROPDOWN_PRESS_SCALE, DROPDOWN_SPRING } from './motion'
import { getDropdownBoxWidths, type DropdownBoxPosition } from './position'

interface DropdownBoxProps {
  boxRef: RefObject<HTMLDivElement | null>
  children: ReactNode
  disabled: boolean

  /** The widest the box has been since it opened, which it keeps while there is room for it */
  grownWidth: number

  hasError: boolean
  open: boolean

  /**
   * Whether the box may be given the whole of its room yet
   *
   * True once it has been on screen for a frame, which is what the widening moves from, and true
   * from the start for a user who has asked for no motion, where there is nothing to move.
   */
  painted: boolean

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
 * Open, it is also as wide as its contents need, between the slot it came from and the room it has,
 * so a list in a narrow table cell is not read through a slot-width window. The browser settles that
 * width from the contents themselves. Both edges the box is pinned by stay where they are, so what
 * grows is the far side of a control the user is already looking at.
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
  grownWidth,
  hasError,
  open,
  painted,
  placed,
  position,
}: DropdownBoxProps) {
  const shouldReduceMotion = useReducedMotion()

  // Widens as it opens and gives the room back as it closes, rather than at the moment the box is
  // placed and the moment it returns to its slot. Taking a width on or losing it in a single frame
  // reads as the control flinching, and the second one moves the chevron long after the user
  // pressed anything
  const { maxWidth, minWidth, width } = getDropdownBoxWidths({
    grownWidth,
    open,
    painted,
    position,
  })

  return (
    <motion.div
      ref={boxRef}
      className={joinClassNames(
        'app-dropdown-glass',
        open && 'app-dropdown-glass-open',
        placed && 'app-dropdown-glass-floating',
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
          // Sized to what it holds while it is open, and to the width it reached while it closes
          width,
          minWidth,
          maxWidth,
          maxHeight: position.boxMaxHeight,
          zIndex: DROPDOWN_OPEN_Z_INDEX,
        }
        : { position: 'absolute', top: 0, left: 0, right: 0 }}
      // Sinks under a press and springs back when it is let go. Suppressed for as long as the box is
      // floating, where sinking a full-height list reads as it collapsing early rather than as a
      // control being pressed
      whileTap={placed || disabled || shouldReduceMotion ? undefined : { scale: DROPDOWN_PRESS_SCALE }}
      transition={DROPDOWN_SPRING}
    >
      {children}
    </motion.div>
  )
}
