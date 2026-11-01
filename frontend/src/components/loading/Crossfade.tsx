import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react'
import { AnimatePresence, motion, useIsPresent, usePresence } from 'motion/react'
import { useEasedWidth } from '@/hooks/useEasedWidth'
import { CONTENT_EASE_CURVE, CONTENT_EASE_MS, getWordSwapShares, prefersReducedMotion } from '@/utils/widthEase'

// A layer cuts at its own edges, which sit inside the container's padding, so a label wider than the narrowing
// container never reaches its rounded ends. A clip margin cannot do this, since it only moves a cut outward
const LAYER_CLASS_NAME = 'inline-flex max-w-full items-center justify-center overflow-x-clip'

// The outgoing layer spans the container less 1rem on each side, or less once the container is too narrow to
// leave a 1.5rem spinner between them. The container's own padding is no guide, since a spinner-sized
// container has none. A layer given a height of its own stays on the middle through `my-auto`, since a box
// with both edges and a height set would otherwise sit at the top
const OUTGOING_LAYER_CLASS_NAME = 'absolute inset-y-0 my-auto [inset-inline:clamp(0px,calc((100%-1.5rem)/2),1rem)]'

// A fitted layer is never cut by its own edges. It is drawn at its natural width and only shows while the
// container's width has room for it, so nothing reaches the container's ends. The outgoing layer keeps the
// place it had in the flow, which is the container's start when the container justifies its content there,
// so the two layers' parts that stay put, such as an icon, are drawn on the same pixels
const FIT_LAYER_CLASS_NAME = 'inline-flex items-center justify-center whitespace-nowrap'
const FIT_OUTGOING_LAYER_CLASS_NAME = 'absolute top-1/2 -translate-y-1/2'

// Marks the part of a fitted layer that fades, such as a word. What else the layer holds, such as an icon,
// stays whole, since the outgoing and incoming layers draw it in the same place
const FIT_WORD_SELECTOR = '[data-crossfade-word]'

const FADE_TRANSITION = { duration: CONTENT_EASE_MS / 1000, ease: CONTENT_EASE_CURVE } as const

// The fade of a fitted layer follows the width ease exactly: it has the same duration and curve, and its
// keyframe offsets are shares of the eased progress, so the two stay in step at every frame
const FIT_FADE_TIMING = {
  duration: CONTENT_EASE_MS,
  easing: `cubic-bezier(${CONTENT_EASE_CURVE.join(', ')})`,
  fill: 'both',
} as const

/** The widths the container eased between in the render being committed, read by the layers as they start fading */
type EaseRecord = { from: number; to: number }

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
 * A layer that is never cut. Only its marked word fades, and the rest of the layer, such as an icon, stays
 * whole, since the outgoing and incoming layers draw it on the same pixels. The outgoing word is entirely gone
 * before the incoming one begins, so the two are never on screen together. The incoming word also stays
 * invisible until the container is wide enough to hold it, and the outgoing word is gone before the container
 * narrows past it, all against the same eased progress as the container's width. The fade is written in the
 * layout effect that follows the width ease, so it starts on the frame the width does. A layer with no marked
 * word fades as a whole
 */
function FitLayer({
  className,
  children,
  easeRef,
  animatesIn,
}: {
  className?: string
  children: ReactNode
  easeRef: MutableRefObject<EaseRecord | null>
  animatesIn: boolean
}) {
  const [isPresent, safeToRemove] = usePresence()
  const layer = useRef<HTMLDivElement>(null)
  // Whether it began hidden to fade in
  const [beganHidden] = useState(animatesIn)

  useLayoutEffect(() => {
    const element = layer.current
    const ease = easeRef.current
    if (!element) return
    const word = element.querySelector<HTMLElement>(FIT_WORD_SELECTOR) ?? element
    const current = Number(getComputedStyle(word).opacity)
    if (isPresent && (!beganHidden || !ease)) return
    for (const animation of word.getAnimations()) animation.cancel()
    // How far the layer's content reaches from the container's left edge, border included
    const reach = (element.offsetParent?.clientLeft ?? 0) + element.offsetLeft + element.offsetWidth

    if (isPresent) {
      const { incomingStart } = getWordSwapShares(ease!.from, ease!.to, reach, 0)
      word.style.opacity = '0'
      const fade = word.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: Math.min(incomingStart, 0.99) },
          { opacity: 1, offset: 1 },
        ],
        FIT_FADE_TIMING,
      )
      fade.finished.then(
        () => {
          word.style.opacity = '1'
          fade.cancel()
        },
        () => undefined,
      )
      return
    }

    // Everything but the word is drawn again by the layer that replaced this one, so it is dropped at once
    if (word !== element) {
      element.style.visibility = 'hidden'
      word.style.visibility = 'visible'
    }
    const { outgoingEnd } = getWordSwapShares(ease?.from ?? 0, ease?.to ?? 0, 0, reach)
    const fade = word.animate(
      [
        { opacity: current, offset: 0 },
        { opacity: 0, offset: Math.max(outgoingEnd, 0.01) },
        { opacity: 0, offset: 1 },
      ],
      FIT_FADE_TIMING,
    )
    const finish = () => safeToRemove?.()
    fade.finished.then(finish, finish)
    // Runs once for each of the two changes of presence, with the widths of the render that caused it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent])

  return (
    <div
      ref={layer}
      className={`${isPresent ? FIT_LAYER_CLASS_NAME : `${FIT_OUTGOING_LAYER_CLASS_NAME} ${FIT_LAYER_CLASS_NAME}`} ${className ?? ''}`}
      aria-hidden={isPresent ? undefined : true}
    >
      {children}
    </div>
  )
}

/**
 * Marks the container for the stylesheet and eases its width. It is the first thing the crossfade renders,
 * since effects of earlier siblings run first, so the widths are recorded before the layers read them
 */
function EasedWidthAnchor({ swapKey, easeRef }: { swapKey: string; easeRef: MutableRefObject<EaseRecord | null> }) {
  // The hidden anchor marks the container, which the stylesheet gives the rules for an eased width
  const anchor = useRef<HTMLSpanElement>(null)
  const container = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return anchor.current?.parentElement ?? null
      },
    }),
    [],
  )
  useEasedWidth(container, swapKey, (from, to) => {
    easeRef.current = { from, to }
  })
  return <span ref={anchor} hidden data-eased-width="" />
}

/**
 * Fades the old content out as the new fades in, whenever `swapKey` changes, instead of swapping them
 * in one render. Content present at the first render does not fade in, and under reduced motion every
 * swap is instant
 *
 * The container needs `position: relative` for the outgoing content to centre over it, and eases its
 * own width with `useEasedWidth` when the two differ in size
 *
 * With `fitToWidth`, neither piece of content is ever cut by the container's ends while the width eases:
 * the incoming content stays invisible until the width holds it and the outgoing content is gone before
 * the width shrinks past it. Only the child marked `data-crossfade-word` fades, the old one entirely gone
 * before the new one begins, and the rest, such as an icon, stays whole. The container justifies its content
 * to the start so both layers draw the parts that stay on the same pixels. Without `fitToWidth`, content is
 * cut inside the container's padding and the two overlap as they cross, as they always did
 */
export function Crossfade({
  swapKey,
  className,
  fitToWidth = false,
  children,
}: {
  swapKey: string
  className?: string
  fitToWidth?: boolean
  children: ReactNode
}) {
  const easeRef = useRef<EaseRecord | null>(null)
  // Whether the key has changed yet, so content that arrived with the first render is not faded in
  const [seenKey, setSeenKey] = useState(swapKey)
  const [hasSwapped, setHasSwapped] = useState(false)
  if (swapKey !== seenKey) {
    setSeenKey(swapKey)
    setHasSwapped(true)
  }

  return (
    <>
      <EasedWidthAnchor swapKey={swapKey} easeRef={easeRef} />
      {prefersReducedMotion() ? (
        <div className={`${LAYER_CLASS_NAME} ${className ?? ''}`}>{children}</div>
      ) : (
        <AnimatePresence initial={false}>
          {fitToWidth ? (
            <FitLayer key={swapKey} className={className} easeRef={easeRef} animatesIn={hasSwapped}>
              {children}
            </FitLayer>
          ) : (
            <Layer key={swapKey} className={className}>
              {children}
            </Layer>
          )}
        </AnimatePresence>
      )}
    </>
  )
}
