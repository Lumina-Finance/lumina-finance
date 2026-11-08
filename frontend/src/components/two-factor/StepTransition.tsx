import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { getStepTransitions } from '@/components/two-factor/stepMotion'

interface StepTransitionProps {
  /** Identity of the visible step, so a change fades the old body out, then the new one in, and eases the panel height */
  stepKey: string
  /** Heading shared by every step, rendered above the body without cross-fading */
  header?: ReactNode
  /** On a phone, where the modal fills the screen, stretches the step so a footer inside it can sit at the
   *  bottom of the screen, as the form modals' footers do */
  fillPhone?: boolean
  /**
   * Whether the height also eases when the step's own content changes size. Off for a step whose parts
   * unfold on their own. The height then follows at once, easing only between steps
   */
  easeContentChanges?: boolean
  /** Runs once an outgoing step has faded and left */
  onExitComplete?: () => void
  /** Swaps steps at once, with no fade or easing, for a reader who asks for less motion. Other steps keep their motion */
  respectsReducedMotion?: boolean
  children: ReactNode
}

/**
 * Eases a stacked two-factor modal between steps of differing heights. The old body fades out and the
 * new one in while the wrapper animates its real height from the old step to the new one in a single
 * pass, so the panel never snaps and the content is never scaled out of shape the way a layout
 * animation would. The
 * outgoing step is lifted out of flow during the fade, so the measured height already reflects the
 * incoming step
 */
export function StepTransition({
  stepKey,
  header,
  fillPhone = false,
  easeContentChanges = true,
  onExitComplete,
  respectsReducedMotion = false,
  children,
}: StepTransitionProps) {
  const prefersReducedMotion = useReducedMotion()
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  const [isEasing, setIsEasing] = useState(false)
  const [shownKey, setShownKey] = useState(stepKey)
  const [isSwapping, setIsSwapping] = useState(false)
  if (shownKey !== stepKey) {
    setShownKey(stepKey)
    setIsSwapping(true)
  }

  // Track the in-flow content height so the wrapper can ease to it whenever the step or its content
  // changes, such as an error line appearing under the code field
  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) return

    const observer = new ResizeObserver(() => setHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const transitions = getStepTransitions({
    respectsReducedMotion,
    prefersReducedMotion: Boolean(prefersReducedMotion),
    easesHeight: easeContentChanges || isSwapping,
  })

  return (
    <motion.div
      className={fillPhone ? 'max-[1049px]:flex max-[1049px]:min-h-full max-[1049px]:flex-col' : undefined}
      animate={{ height }}
      transition={transitions.height}
      // Clip only while the height eases, so focus rings on the edge controls are not cut off at rest. Clip
      // rather than hide, and only top to bottom, so a dialog footer inside keeps sticking to the panel's
      // bottom and reaching its side edges while it eases
      style={{ overflowX: 'visible', overflowY: isEasing ? 'clip' : 'visible' }}
      onAnimationStart={() => setIsEasing(true)}
      onAnimationComplete={() => {
        setIsEasing(false)
        setIsSwapping(false)
      }}
    >
      <div ref={contentRef} className={`relative flex flex-col gap-5 ${fillPhone ? 'max-[1049px]:flex-1' : ''}`}>
        {header}
        <AnimatePresence mode="popLayout" initial={false} onExitComplete={onExitComplete}>
          <motion.div
            key={stepKey}
            className={fillPhone ? 'max-[1049px]:flex max-[1049px]:flex-1 max-[1049px]:flex-col' : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: transitions.fadeIn }}
            exit={{ opacity: 0, transition: transitions.fadeOut }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
