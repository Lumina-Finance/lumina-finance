import { useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

const UNFOLD_EASE = [0.22, 1, 0.36, 1] as const

type UnfoldProps = {
  children: ReactNode
  flush?: boolean

  /**
   * Clips the content only while it grows or shrinks, so a tooltip or a focus ring inside can reach
   * past its edges once it has settled
   */
  clipsOnlyWhileChanging?: boolean
}

/**
 * Grows its content in and out by height as AnimatePresence adds and removes it, so what sits below
 * never jumps. The gap above the content sits inside, since padding on a box whose height animates to
 * zero stays behind. Flush content has its own divider marking its top edge and goes without the gap
 */
export function Unfold({ children, flush = false, clipsOnlyWhileChanging = false }: UnfoldProps) {
  const prefersReducedMotion = useReducedMotion()

  // Starts settled, since content shown with the page doesn't grow in and so never finishes doing so
  const [changing, setChanging] = useState(false)
  const clips = !clipsOnlyWhileChanging || changing

  return (
    <motion.div
      className={clips ? 'overflow-hidden' : undefined}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: UNFOLD_EASE }}
      onAnimationStart={clipsOnlyWhileChanging ? () => setChanging(true) : undefined}
      onAnimationComplete={clipsOnlyWhileChanging ? () => setChanging(false) : undefined}
    >
      <div className={flush ? undefined : 'pt-4'}>{children}</div>
    </motion.div>
  )
}
