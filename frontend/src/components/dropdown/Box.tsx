import type { CSSProperties, ReactNode, RefObject } from 'react'
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

  /**
   * Whether the clip has been let go, which is what plays the reveal
   *
   * Held for one frame after the box opens so the clip has a starting value to travel from, and taken
   * back to start the collapse.
   */
  revealed: boolean

  /** How tall the head is, which is the part the clip leaves showing while the rest is hidden */
  headHeight: number
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
  headHeight,
  placed,
  position,
  revealed,
}: DropdownBoxProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      ref={boxRef}
      className={joinClassNames(
        'app-dropdown-glass',
        open && 'app-dropdown-glass-open',
        revealed && 'app-dropdown-glass-revealed',
        placed && position.openAbove && 'app-dropdown-glass-up',
        hasError && 'app-dropdown-glass-error',
        disabled && 'app-dropdown-glass-disabled',
      )}
      style={(placed
        ? {
          // Hides everything but the head, from whichever edge the list grows away from
          '--app-dropdown-clip': position.openAbove
            ? `inset(calc(100% - ${headHeight}px) 0 0 0 round var(--app-dropdown-radius))`
            : `inset(0 0 calc(100% - ${headHeight}px) 0 round var(--app-dropdown-radius))`,
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
        : { position: 'absolute', top: 0, left: 0, right: 0 }) as CSSProperties}
      // Sinks under a press and springs back when it is let go. Suppressed once open, where sinking
      // a full-height list reads as the box collapsing early rather than as a control being pressed
      whileTap={open || disabled || shouldReduceMotion ? undefined : { scale: DROPDOWN_PRESS_SCALE }}
      transition={DROPDOWN_SPRING}
    >
      {children}
    </motion.div>
  )
}
