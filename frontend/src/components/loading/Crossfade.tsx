import { useMemo, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useEasedWidth } from '@/hooks/useEasedWidth'
import { CONTENT_EASE_CURVE, CONTENT_EASE_MS, prefersReducedMotion } from '@/utils/widthEase'

// A layer cuts at its own edges, which sit inside the container's padding, so a label wider than the narrowing
// container never reaches its rounded ends. A clip margin cannot do this, since it only moves a cut outward
const LAYER_CLASS_NAME = 'inline-flex max-w-full items-center justify-center overflow-x-clip'

// The outgoing layer spans the container less 1rem on each side, or less once the container is too narrow to
// leave a 1.5rem spinner between them. The container's own padding is no guide, since a spinner-sized
// container has none. A layer given a height of its own stays on the middle through `my-auto`, since a box
// with both edges and a height set would otherwise sit at the top
const OUTGOING_LAYER_CLASS_NAME = 'absolute inset-y-0 my-auto [inset-inline:clamp(0px,calc((100%-1.5rem)/2),1rem)]'

const FADE_TRANSITION = { duration: CONTENT_EASE_MS / 1000, ease: CONTENT_EASE_CURVE } as const

/**
 * One piece of content in the crossfade. Once replaced it leaves the layout and stays centred over
 * its container while it fades, so the container is sized by what replaced it alone, and it is hidden
 * from screen readers, which then hear only the content that is staying
 */
function Layer({ className, children }: { className?: string; children: ReactNode }) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      className={`${isPresent ? LAYER_CLASS_NAME : `${OUTGOING_LAYER_CLASS_NAME} ${LAYER_CLASS_NAME}`} ${className ?? ''}`}
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
export function Crossfade({
  swapKey,
  className,
  children,
}: {
  swapKey: string
  className?: string
  children: ReactNode
}) {
  // The hidden anchor marks the container, which the stylesheet gives the rules for an eased width
  const anchor = useRef<HTMLSpanElement>(null)
  const container = useMemo(
    () => ({
      get current() {
        return anchor.current?.parentElement ?? null
      },
    }),
    [],
  )
  useEasedWidth(container, swapKey)

  return (
    <>
      <span ref={anchor} hidden data-eased-width="" />
      {prefersReducedMotion() ? (
        <div className={`${LAYER_CLASS_NAME} ${className ?? ''}`}>{children}</div>
      ) : (
        <AnimatePresence initial={false}>
          <Layer key={swapKey} className={className}>
            {children}
          </Layer>
        </AnimatePresence>
      )}
    </>
  )
}
