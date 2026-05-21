import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

const loadingVisibilityTransition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as const

export function InsightLoadingContent({
  children,
  concealed,
  shouldReduceMotion,
  className,
  style,
}: {
  children: ReactNode
  concealed: boolean
  shouldReduceMotion: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <motion.div
      className={className}
      animate={{
        filter: concealed ? 'blur(8px)' : 'blur(0px)',
        opacity: concealed ? 0 : 1,
      }}
      transition={shouldReduceMotion ? { duration: 0 } : loadingVisibilityTransition}
      style={style}
    >
      {children}
    </motion.div>
  )
}

export function InsightLoadingOverlay({
  visible,
  shouldReduceMotion,
  label,
  className = 'absolute inset-0 flex items-center justify-center',
}: {
  visible: boolean
  shouldReduceMotion: boolean
  label: string
  className?: string
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={className}
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : loadingVisibilityTransition}
        >
          <div className="app-spinner" aria-label={label} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
