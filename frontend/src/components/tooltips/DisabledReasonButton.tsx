import { forwardRef, type ButtonHTMLAttributes, type RefObject } from 'react'
import { HintButton } from '@/components/tooltips/HintButton'
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

  /** Another element beside the button, such as a line printed above it, that the reason never covers */
  keepReasonClearOf?: RefObject<HTMLElement | null>

  /** What the button does while it is available, put away while the reason shows so the two never stack */
  hint?: string | null
}

/**
 * A button that explains itself while it is unavailable
 *
 * It stays focusable and hoverable, marked `aria-disabled` instead of `disabled`, so the reason reaches
 * the mouse, the keyboard, a touch and a screen reader. Its action never runs while the reason holds
 */
export const DisabledReasonButton = forwardRef<HTMLButtonElement, DisabledReasonButtonProps>(
  function DisabledReasonButton(
    {
      disabledReason,
      reasonShownById,
      keepReasonClearOf,
      hint,
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
    },
    ref,
  ) {
    const reason = useDisabledReason(disabledReason, reasonShownById, keepReasonClearOf)
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
        <HintButton
          {...rest}
          {...reasonProps}
          ref={ref}
          type={type}
          hint={reason.isUnavailable ? null : hint}
          disabled={reason.isUnavailable ? undefined : disabled}
        />
        {reason.tooltip}
      </>
    )
  },
)
