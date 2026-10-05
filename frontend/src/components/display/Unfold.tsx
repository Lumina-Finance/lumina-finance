import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

const UNFOLD_EASE = [0.22, 1, 0.36, 1] as const

/**
 * Grows its content in and out by height as AnimatePresence adds and removes it, so what sits below
 * never jumps. The gap above the content sits inside, since padding on a box whose height animates to
 * zero stays behind
 */
export function Unfold({ children }: { children: ReactNode }) {
  const prefersReducedMotion = useReducedMotion()
  return (
    <motion.div
      className="overflow-hidden"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: UNFOLD_EASE }}
    >
      <div className="pt-4">{children}</div>
    </motion.div>
  )
}
