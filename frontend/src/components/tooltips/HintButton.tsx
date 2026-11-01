import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { useControlHint } from '@/hooks/useDisabledReason'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'

type HintButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * What the button does, in the app's tooltip under a mouse pointer and on keyboard focus. With no hint
   * the button is a plain one. A button with no visible text still names itself with `aria-label`
   */
  hint?: string | null
}

/**
 * A button that says what it does in the app's own tooltip, in place of the browser's `title`
 *
 * It is the tooltip of `DisabledReasonButton` for a button that works: it never shows on a touch, never
 * holds a click back, and hangs clear of the button, so nothing it explains is covered
 */
export const HintButton = forwardRef<HTMLButtonElement, HintButtonProps>(function HintButton(
  {
    hint,
    onClick,
    onKeyDown,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    onFocus,
    onBlur,
    'aria-describedby': describedBy,
    'aria-disabled': ariaDisabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const { controlProps, tooltip } = useControlHint(hint)
  const hintProps = getDisabledReasonProps<HTMLButtonElement>(
    { isUnavailable: false, controlProps, handleBlockedClick: () => undefined },
    {
      'aria-describedby': describedBy,
      onClick,
      onKeyDown,
      onMouseEnter,
      onMouseMove,
      onMouseLeave,
      onFocus,
      onBlur,
    },
  )

  return (
    <>
      <button {...rest} {...hintProps} aria-disabled={ariaDisabled} ref={ref} type={type} />
      {tooltip}
    </>
  )
})
