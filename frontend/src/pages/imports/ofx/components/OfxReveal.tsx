import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

// The height and fade the file slot's staged file uses to swap in, so a notice or list that arrives
// after the step is on screen grows into place the same way and does not push what is below it
const REVEAL_EASE = [0.25, 0.1, 0.25, 1] as const
const REVEAL_DURATION = 0.24

/**
 * Grows what the OFX import shows only some of the time into place with a height and fade, and
 * closes it the same way, with no movement for a user who asked for less
 *
 * What is already there when the step first renders appears as it is, so only what arrives later
 * moves. The overflow is clipped while the height moves and let go once it settles, so a focus ring
 * on the control inside is not cut
 *
 * @param show - Whether the children are on screen
 * @param children - The notice or list to reveal, built only while it is shown
 */
export function OfxReveal({ show, children }: { show: boolean; children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion()
  const transition = { duration: shouldReduceMotion ? 0 : REVEAL_DURATION, ease: REVEAL_EASE }

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
          animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
          exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
