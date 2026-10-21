import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { Check, LoaderCircle } from 'lucide-react'
import { useDisabledReason } from '@/hooks/useDisabledReason'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'

export type ActionFeedbackStatus = 'idle' | 'loading' | 'success'

const STATE_STYLE_TRANSITION = 'background 250ms ease, border-color 250ms ease, color 250ms ease, var(--app-focus-fade)'

interface ActionFeedbackButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode
  loadingLabel?: string
  status: ActionFeedbackStatus
  successLabel?: string

  /** Why the button is unavailable, shown in a tooltip beside the cursor, on keyboard focus and on a tap */
  disabledReason?: string | null
}

const ActionFeedbackButton = forwardRef<HTMLButtonElement, ActionFeedbackButtonProps>(
  function ActionFeedbackButton({
    children,
    className = 'app-primary-button',
    disabled,
    disabledReason,
    loadingLabel = 'Loading',
    onBlur,
    onClick,
    onFocus,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
    onMouseMove,
    status,
    style,
    successLabel = 'Saved',
    'aria-describedby': describedBy,
    ...props
  }, ref) {
    const reason = useDisabledReason(disabledReason)
    const reasonProps = getDisabledReasonProps<HTMLButtonElement>(reason, {
      'aria-describedby': describedBy,
      onClick,
      onKeyDown,
      onMouseEnter,
      onMouseMove,
      onMouseLeave,
      onFocus,
      onBlur,
    })
    const stateStyle = status === 'success'
      ? {
          background: 'var(--app-positive)',
          borderColor: 'var(--app-positive)',
          color: '#fff',
        }
      : {}

    return (
      <>
        <motion.button
          {...props}
          aria-busy={status === 'loading'}
          {...reasonProps}
          className={className}
          disabled={reason.isUnavailable ? undefined : disabled}
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
        {reason.tooltip}
      </>
    )
  },
)

export default ActionFeedbackButton
