import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { Check, LoaderCircle } from 'lucide-react'
import { useDisabledReason } from '@/hooks/useDisabledReason'

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
    const { controlProps } = reason
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
          aria-disabled={controlProps['aria-disabled']}
          aria-describedby={[describedBy, controlProps['aria-describedby']].filter(Boolean).join(' ') || undefined}
          className={className}
          disabled={reason.isUnavailable ? undefined : disabled}
          ref={ref}
          style={{
            ...style,
            transition: STATE_STYLE_TRANSITION,
            ...stateStyle,
          }}
          onClick={(event) => {
            if (reason.isUnavailable) {
              reason.handleBlockedClick(event)
              return
            }
            onClick?.(event)
          }}
          onMouseEnter={(event) => {
            onMouseEnter?.(event)
            controlProps.onMouseEnter?.(event)
          }}
          onMouseMove={(event) => {
            onMouseMove?.(event)
            controlProps.onMouseMove?.(event)
          }}
          onMouseLeave={(event) => {
            onMouseLeave?.(event)
            controlProps.onMouseLeave?.()
          }}
          onFocus={(event) => {
            onFocus?.(event)
            controlProps.onFocus?.(event)
          }}
          onBlur={(event) => {
            onBlur?.(event)
            controlProps.onBlur?.()
          }}
          onKeyDown={onKeyDown}
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
