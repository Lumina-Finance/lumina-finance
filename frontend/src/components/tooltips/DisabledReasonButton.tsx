import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { useDisabledReason } from '@/hooks/useDisabledReason'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'

type DisabledReasonButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * Why the button is unavailable, shown in a tooltip beside the cursor, on keyboard focus and on a
   * tap. With no reason the button is a plain one, held off by `disabled` alone, which suits a button
   * that is only waiting on its own request
   */
  disabledReason?: string | null

  /** The id of an element on the page that already prints the reason, which then describes the button */
  reasonShownById?: string
}

/**
 * A button that explains itself while it is unavailable
 *
 * It stays focusable and hoverable, marked `aria-disabled` instead of `disabled`, so the reason reaches
 * the mouse, the keyboard, a touch and a screen reader. Its action never runs while the reason holds
 */
export const DisabledReasonButton = forwardRef<HTMLButtonElement, DisabledReasonButtonProps>(
  function DisabledReasonButton({
    disabledReason,
    reasonShownById,
    disabled,
    onClick,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    onFocus,
    onBlur,
    onKeyDown,
    'aria-describedby': describedBy,
    type = 'button',
    ...rest
  }, ref) {
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

    return (
      <>
        <button
          {...rest}
          {...reasonProps}
          ref={ref}
          type={type}
          disabled={reason.isUnavailable ? undefined : disabled}
        />
        {reason.tooltip}
      </>
    )
  },
)
