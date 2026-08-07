import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export const LOADING_VISIBILITY_MS = 320
const LOADING_VISIBILITY_EASE = [0.22, 1, 0.36, 1] as const

const loadingVisibilityTransition = {
  duration: LOADING_VISIBILITY_MS / 1000,
  ease: LOADING_VISIBILITY_EASE,
} as const

/** The same timing as a CSS transition value, for the parts animated by style rather than by motion */
export const loadingVisibilityCss = `${LOADING_VISIBILITY_MS}ms cubic-bezier(${LOADING_VISIBILITY_EASE.join(', ')})`

/**
 * Conceals content while preserving its layout box during loading transitions
 *
 * Revealed content carries no filter at all rather than a resting `blur(0px)`, because any filter
 * makes this element the box a `position: fixed` descendant is measured from, which would open a
 * drop-down inside it away from the control it belongs to. Getting there means the browser's own
 * transition rather than a motion animation, since motion keeps writing the value it settled on
 */
export function LoadingContent({
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
    <div
      className={className}
      style={{
        filter: concealed ? 'blur(8px)' : undefined,
        opacity: concealed ? 0 : 1,
        transition: shouldReduceMotion
          ? undefined
          : `filter ${loadingVisibilityCss}, opacity ${loadingVisibilityCss}`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Displays the shared spinner overlay with consistent enter and exit timing
 */
export function LoadingOverlay({
  visible,
  shouldReduceMotion,
  label,
  className = 'absolute inset-0 flex items-center justify-center',
  style,
}: {
  visible: boolean
  shouldReduceMotion: boolean
  label: string
  className?: string
  style?: CSSProperties
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
          style={style}
        >
          <div className="app-spinner" role="status" aria-label={label} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
