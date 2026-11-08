import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { Check } from 'lucide-react'
import { Crossfade } from '@/components/loading/Crossfade'
import { NamedSpinner } from '@/components/loading/PendingLabel'
import { useDisabledReason } from '@/hooks/useDisabledReason'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'

export type ActionFeedbackStatus = 'idle' | 'loading' | 'success'

// Not `all`: a width transition would report the old width while the crossfade measures the new one
const STATE_STYLE_TRANSITION = ['color', 'background-color', 'border-color', 'opacity', 'transform', 'border-radius']
  .map((property) => `${property} var(--app-ease-duration) var(--app-ease-curve)`)
  .concat('var(--app-focus-fade)')
  .join(', ')

interface ActionFeedbackButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode
  loadingLabel?: string
  status: ActionFeedbackStatus
  successLabel?: string

  /** Why the button is unavailable, shown in a tooltip beside the cursor, on keyboard focus and on a tap */
  disabledReason?: string | null

  /** The id of an element on the page that already prints the reason, which then describes the button */
  reasonShownById?: string

  /**
   * The hidden labels `useFittedButtonWidth` measures, kept in whatever the status, so a button that
   * first shows its spinner still takes its label's width
   */
  measure?: ReactNode
}

const ActionFeedbackButton = forwardRef<HTMLButtonElement, ActionFeedbackButtonProps>(function ActionFeedbackButton(
  {
    children,
    className = 'app-primary-button',
    disabled,
    disabledReason,
    loadingLabel = 'Loading',
    measure,
    onBlur,
    onClick,
    onFocus,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
    onMouseMove,
    reasonShownById,
    status,
    style,
    successLabel = 'Saved',
    'aria-describedby': describedBy,
    ...props
  },
  ref,
) {
  const reason = useDisabledReason(disabledReason, reasonShownById)
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
  const stateStyle =
    status === 'success'
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
        // The reason's own marking wins, and a caller's, such as a button held off while its sibling's request runs, stands otherwise
        aria-disabled={reasonProps['aria-disabled'] ?? props['aria-disabled']}
        className={className}
        disabled={reason.isUnavailable ? undefined : disabled}
        ref={ref}
        style={{
          ...style,
          transition: STATE_STYLE_TRANSITION,
          ...stateStyle,
        }}
      >
        <Crossfade swapKey={status} className="h-6 min-w-6">
          {status === 'success' ? (
            <span role="img" aria-label={successLabel}>
              <Check size={16} strokeWidth={2.5} aria-hidden />
            </span>
          ) : status === 'loading' ? (
            <NamedSpinner name={loadingLabel} />
          ) : (
            children
          )}
        </Crossfade>
        {measure}
      </motion.button>
      {reason.tooltip}
    </>
  )
})

export default ActionFeedbackButton
