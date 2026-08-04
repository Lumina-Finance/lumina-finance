import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  DROPDOWN_INSTANT_TRANSITION,
  DROPDOWN_PANEL_CLOSE_TRANSITION,
  DROPDOWN_PANEL_OPEN_TRANSITION,
} from './motion'
import type { DropdownListPosition } from './position'

interface DropdownPanelProps {
  children: ReactNode
  position: DropdownListPosition
}

// Above both modal levels and the mobile filter sheet, matching the level the date picker already
// takes so a menu and a calendar opened from the same form agree on which sits in front
const DROPDOWN_PANEL_Z_INDEX = 110

/**
 * Renders the open list as a glass box pinned to the pill, growing open from the edge it is anchored by
 *
 * Positioned `fixed` but left inside the trigger's own wrapper rather than portalled, because a
 * modal decides whether focus is still inside it, and this drop-down decides whether a press was
 * outside it, by asking whether the element is a descendant.
 *
 * That costs one constraint: no ancestor of a drop-down may carry a backdrop filter, a filter or a
 * transform once it has settled. Any of those makes the ancestor the box these viewport coordinates
 * are measured from, which moves the panel and clips it. The glass filter panel on the transactions
 * toolbar is such an ancestor, so a drop-down cannot be placed inside it as things stand.
 */
export function DropdownPanel({ children, position }: DropdownPanelProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      className="app-dropdown-panel fixed"
      style={{
        // Pinned by the edge nearest the pill, so the growing height moves the far edge away from
        // it rather than dragging the whole panel across the field
        bottom: position.openAbove ? position.bottom : undefined,
        left: position.left,
        top: position.openAbove ? undefined : position.top,
        maxHeight: position.menuMaxHeight,
        width: position.width,
        zIndex: DROPDOWN_PANEL_Z_INDEX,
      }}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{
        height: 0,
        opacity: 0,
        transition: shouldReduceMotion ? DROPDOWN_INSTANT_TRANSITION : DROPDOWN_PANEL_CLOSE_TRANSITION,
      }}
      transition={shouldReduceMotion ? DROPDOWN_INSTANT_TRANSITION : DROPDOWN_PANEL_OPEN_TRANSITION}
    >
      <div className="app-dropdown-panel-inner">{children}</div>
    </motion.div>
  )
}
