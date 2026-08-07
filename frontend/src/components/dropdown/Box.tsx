import { useLayoutEffect, type ReactNode, type RefObject } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { STACKING_LEVELS } from '@/constants/stackingLevels'
import { joinClassNames } from '@/utils/classNames'
import {
  DROPDOWN_INSTANT_TRANSITION,
  DROPDOWN_NARROW_TRANSITION,
  DROPDOWN_PRESS_SCALE,
  DROPDOWN_SPRING,
  DROPDOWN_WIDEN_SPRING,
} from './motion'
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

// What the box is while it sits in its slot, which is the whole of it. Written as the width rather
// than left with none, so the value the animation drives is the only thing that ever sets it
const SLOT_WIDTH = '100%'

/**
 * Renders the one box that holds the head and the list, and grows around them as it opens
 *
 * Closed, it sits absolutely inside its own wrapper, which costs nothing and keeps it in the page.
 * Open, the same element switches to fixed at the head's measured position, so it can grow past a
 * scrolling table or a modal body without being cut off. Switching only the positioning means the
 * head is never remounted, so focus, its id and the modal's own Tab handling carry straight through.
 *
 * Open, it is also as wide as the room it has allows, up to a maximum, so a list in a narrow table
 * cell is not read through a slot-width window. Both edges the box is pinned by stay where they are,
 * so what grows is the far side of a control the user is already looking at.
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

  // The width is driven as a value of its own rather than through the style, which is what keeps a
  // single owner: a render landing part way through the widening would otherwise write the box back
  // to where it started, and the first frame of an opening would have nothing to widen from
  const boxWidth = useMotionValue<number | string>(SLOT_WIDTH)

  // A spring on the way out, in the family the insights range control and the toolbar filter pill
  // use for their own width, and the height's own closing timing on the way back, so the width
  // settles when the list does rather than carrying on under a list that has arrived
  const widthTransition = shouldReduceMotion
    ? DROPDOWN_INSTANT_TRANSITION
    : open ? DROPDOWN_WIDEN_SPRING : DROPDOWN_NARROW_TRANSITION

  // Settled here rather than in the effect below, so the width is already right in the frame that
  // takes the box out of the page. Set a moment later, the box would be seen at the whole width of
  // the screen first, which is what a proportion means to an element measured against the viewport
  if (!placed) {
    boxWidth.set(SLOT_WIDTH)
  } else if (typeof boxWidth.get() !== 'number') {
    // An opening starts from the slot, since a proportion is not a width the box can widen from
    boxWidth.set(position.width)
  }

  useLayoutEffect(() => {
    if (!placed) return

    const controls = animate(boxWidth, open ? position.openWidth : position.width, widthTransition)
    return () => controls.stop()
  }, [boxWidth, open, placed, position.openWidth, position.width, widthTransition])

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
          // Pinned by whichever of the slot's own side edges the box grows away from, so that edge
          // does not move as the box widens, exactly as its upper and lower edges work
          left: position.openLeftward ? undefined : position.left,
          right: position.openLeftward ? position.right : undefined,
          width: boxWidth,
          // Keeps the spring's overshoot, a few pixels at the end of a long widening, out of the
          // room the box leaves clear of the edge of the screen
          maxWidth: position.openWidth,
          maxHeight: position.boxMaxHeight,
          // The box is fixed in place rather than portalled, so this orders it against whatever
          // stacking context it lands in and never against the whole app. Opened from a page that is
          // the page, which is isolated as one context, so the navigation and a toast still draw over
          // the open list. Opened inside a modal or the filter sheet, both fixed with a level of
          // their own, it is that container. What the level buys either way is the box over the
          // content it grows across, and agreement with the calendar, which takes the same one
          zIndex: STACKING_LEVELS.popover,
        }
        : { position: 'absolute', top: 0, left: 0, right: 0, width: boxWidth }}
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
