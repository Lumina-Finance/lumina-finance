import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

const EASE = [0.25, 0.1, 0.25, 1] as const
const MORE_BUTTON_INITIAL = { opacity: 0, y: 6, scale: 0.96 }
const MORE_BUTTON_ANIMATE = { opacity: 1, y: 0, scale: 1 }
const MORE_BUTTON_EXIT = { opacity: 0, y: 6, scale: 0.96 }
const MORE_BUTTON_TRANSITION = { duration: 0.2, ease: EASE }

/**
 * Floating button prompting the user to scroll for more items in a list, appearing and disappearing
 * with a fade and scale transition gated by `show`
 */
export default function ScrollableListMoreButton({
  show,
  onClick,
  ariaLabel,
}: {
  show: boolean
  onClick: () => void
  ariaLabel: string
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.button
          type="button"
          className="absolute bottom-2 left-[calc(50%-1rem)] z-10 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--app-button-primary-bg)] text-[var(--app-button-primary-text)] transition-colors duration-150 hover:bg-[var(--app-button-primary-bg-hover)] active:bg-[var(--app-button-primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)]"
          onClick={onClick}
          aria-label={ariaLabel}
          initial={shouldReduceMotion ? false : MORE_BUTTON_INITIAL}
          animate={shouldReduceMotion ? { opacity: 1 } : MORE_BUTTON_ANIMATE}
          exit={shouldReduceMotion ? { opacity: 0 } : MORE_BUTTON_EXIT}
          transition={MORE_BUTTON_TRANSITION}
        >
          <span className="app-merchant-more-glyph flex items-center justify-center">
            <ArrowDown size={19} strokeWidth={2.5} aria-hidden />
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
