import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  COLLAPSIBLE_SECTION_EASE,
  COLLAPSIBLE_SECTION_TRANSITION_SECONDS,
} from '@/components/collapsible-section/motion'

interface RevealRowProps {
  children: ReactNode
  testId?: string
}

/**
 * Grows into place when it mounts and collapses away when its parent's `AnimatePresence` removes it, so
 * a row that joins or leaves a list moves the content beneath it smoothly rather than snapping. It
 * uses the timing the collapsible sections use. The row spaces itself with bottom padding, since a
 * margin or a gap between siblings would still snap as the row goes
 */
export default function RevealRow({ children, testId }: RevealRowProps) {
  const prefersReducedMotion = useReducedMotion()
  const transition = {
    duration: prefersReducedMotion ? 0 : COLLAPSIBLE_SECTION_TRANSITION_SECONDS,
    ease: COLLAPSIBLE_SECTION_EASE,
  }
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={transition}
      style={{ overflow: 'hidden' }}
      data-testid={testId}
    >
      <div className="pb-2">{children}</div>
    </motion.div>
  )
}
