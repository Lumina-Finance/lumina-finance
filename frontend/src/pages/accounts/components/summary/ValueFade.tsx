import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

type SummaryValueFadeProps = {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
}

/**
 * Swaps summary skeletons and values without changing the surrounding layout contract
 */
export function SummaryValueFade({
  loading,
  skeleton,
  children,
}: SummaryValueFadeProps) {
  const shouldReduceMotion = useReducedMotion() ?? false
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.42, 0, 0.58, 1] as const }

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {loading ? (
        <motion.div
          key="skeleton"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key="value"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
