import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { Check, LoaderCircle } from 'lucide-react'

export type ActionFeedbackStatus = 'idle' | 'loading' | 'success'

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
        <span className="inline-flex h-6 min-w-6 items-center justify-center">
          {status === 'success' ? (
            <span aria-label={successLabel}>
              <Check size={16} strokeWidth={2.5} aria-hidden />
            </span>
          ) : status === 'loading' ? (
            <span className="inline-flex items-center justify-center" aria-label={loadingLabel}>
              <LoaderCircle size={18} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
            </span>
          ) : (
            children
          )}
        </span>
      </motion.button>
    )
  },
)

export default ActionFeedbackButton
