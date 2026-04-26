import { forwardRef, type ReactNode } from 'react'
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react'
import { Check } from 'lucide-react'

export type ActionFeedbackStatus = 'idle' | 'loading' | 'success'

const CONTENT_EASE = [0.25, 0.1, 0.25, 1] as const
const STATE_STYLE_TRANSITION = 'background 250ms ease, border-color 250ms ease, color 250ms ease'

interface ActionFeedbackButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode
  loadingLabel?: string
  status: ActionFeedbackStatus
  successLabel?: string
}

const ActionFeedbackButton = forwardRef<HTMLButtonElement, ActionFeedbackButtonProps>(
  function ActionFeedbackButton({
    children,
    className = 'app-primary-button',
    loadingLabel = 'Loading',
    status,
    style,
    successLabel = 'Saved',
    ...props
  }, ref) {
    const stateStyle = status === 'success'
      ? {
          background: 'var(--app-positive)',
          borderColor: 'var(--app-positive)',
          color: '#fff',
        }
      : {}

    return (
      <motion.button
        {...props}
        aria-busy={status === 'loading'}
        className={className}
        ref={ref}
        style={{
          ...style,
          transition: STATE_STYLE_TRANSITION,
          ...stateStyle,
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === 'success' ? (
            <motion.span
              key="success"
              className="inline-flex h-6 items-center justify-center"
              aria-label={successLabel}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.14, ease: CONTENT_EASE }}
            >
              <Check size={16} strokeWidth={2.5} aria-hidden />
            </motion.span>
          ) : status === 'loading' ? (
            <motion.span
              key="loading"
              className="inline-flex h-6 items-center justify-center"
              aria-label={loadingLabel}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.14, ease: CONTENT_EASE }}
            >
              <div className="app-spinner" />
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              className="inline-flex h-6 items-center justify-center"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.12, ease: CONTENT_EASE }}
            >
              {children}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    )
  },
)

export default ActionFeedbackButton
