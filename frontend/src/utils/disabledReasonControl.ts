import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import type { DisabledReasonControlProps } from '@/hooks/useDisabledReason'

/** The part of `useDisabledReason`'s result a control's props are built from */
type DisabledReasonState = {
  isUnavailable: boolean
  controlProps: DisabledReasonControlProps
  handleBlockedClick: (event: MouseEvent<HTMLElement>) => void
}

/** What the control already does or says on its own, which the reason is composed with */
type OwnControlProps<E extends HTMLElement> = {
  'aria-describedby'?: string
  onClick?: (event: MouseEvent<E>) => void
  onKeyDown?: (event: KeyboardEvent<E>) => void
  onMouseEnter?: (event: MouseEvent<E>) => void
  onMouseMove?: (event: MouseEvent<E>) => void
  onMouseLeave?: (event: MouseEvent<E>) => void
  onFocus?: (event: FocusEvent<E>) => void
  onBlur?: (event: FocusEvent<E>) => void
}

/**
 * Builds the props of a control that explains why it is unavailable, from the control's own handlers
 *
 * While the reason holds, a click only shows the reason and a key press does nothing, so neither
 * reaches the control's action, as the native `disabled` attribute would have stopped them. The
 * control's own hover and focus handlers still run beside the ones that show the reason
 */
export function getDisabledReasonProps<E extends HTMLElement>(
  reason: DisabledReasonState,
  own: OwnControlProps<E>,
) {
  const { controlProps } = reason

  return {
    'aria-disabled': controlProps['aria-disabled'],
    'aria-describedby': [own['aria-describedby'], controlProps['aria-describedby']].filter(Boolean).join(' ') || undefined,
    onClick: (event: MouseEvent<E>) => {
      if (reason.isUnavailable) {
        reason.handleBlockedClick(event)
        return
      }
      own.onClick?.(event)
    },
    onKeyDown: (event: KeyboardEvent<E>) => {
      if (reason.isUnavailable) return
      own.onKeyDown?.(event)
    },
    onMouseEnter: (event: MouseEvent<E>) => {
      own.onMouseEnter?.(event)
      controlProps.onMouseEnter?.(event)
    },
    onMouseMove: (event: MouseEvent<E>) => {
      own.onMouseMove?.(event)
      controlProps.onMouseMove?.(event)
    },
    onMouseLeave: (event: MouseEvent<E>) => {
      own.onMouseLeave?.(event)
      controlProps.onMouseLeave?.()
    },
    onFocus: (event: FocusEvent<E>) => {
      own.onFocus?.(event)
      controlProps.onFocus?.(event)
    },
    onBlur: (event: FocusEvent<E>) => {
      own.onBlur?.(event)
      controlProps.onBlur?.()
    },
  }
}
