import type { ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { CONTENT_EASE_CURVE, CONTENT_EASE_MS, prefersReducedMotion } from '@/utils/widthEase'

const LAYER_CLASS_NAME = 'inline-flex items-center justify-center'

const FADE_TRANSITION = { duration: CONTENT_EASE_MS / 1000, ease: CONTENT_EASE_CURVE } as const

/**
 * One piece of content in the crossfade. Once replaced it leaves the layout and stays centred over
 * its container while it fades, so the container is sized by what replaced it alone, and it is hidden
 * from screen readers, which then hear only the content that is staying
 */
function Layer({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      className={isPresent ? LAYER_CLASS_NAME : `absolute inset-0 ${LAYER_CLASS_NAME}`}
      aria-hidden={isPresent ? undefined : true}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={FADE_TRANSITION}
    >
      {children}
    </motion.div>
  )
}

/**
 * Fades the old content out as the new fades in, whenever `swapKey` changes, instead of swapping them
 * in one render. Content present at the first render does not fade in, and under reduced motion every
 * swap is instant
 *
 * The container needs `position: relative` for the outgoing content to centre over it, and eases its
 * own width with `useEasedWidth` when the two differ in size
 */
export function Crossfade({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  if (prefersReducedMotion()) return <div className={LAYER_CLASS_NAME}>{children}</div>
  return (
    <AnimatePresence initial={false}>
      <Layer key={swapKey}>{children}</Layer>
    </AnimatePresence>
  )
}
