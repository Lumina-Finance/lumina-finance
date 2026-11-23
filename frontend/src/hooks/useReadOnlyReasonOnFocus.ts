import { useDisabledReason } from '@/hooks/useDisabledReason'

/**
 * Shows a read-only reason on keyboard focus of the control a row or card already offers, in place of a
 * focusable pill, so the row keeps a single tab stop
 *
 * Spread `focusProps` on that control and draw `tooltip` beside it. The reason sits beside the control,
 * or beside the box its `data-reason-beside` selector names. Only focus shows it, since the pill already
 * answers the pointer. The control stays enabled and unmarked, and the hook adds nothing for a screen
 * reader. A transaction title and an account link name the pill in their own `aria-describedby`. A
 * budget card and a category row hold the pill inside them, so their content already reads the reason
 *
 * @param reason - The reason, or nothing while the record can change or another reason holds the control
 * @param pillId - The id of the pill showing the same reason on the row
 */
export function useReadOnlyReasonOnFocus(reason: string | null | undefined, pillId: string) {
  const { controlProps, tooltip } = useDisabledReason(reason, pillId)
  return { focusProps: { onFocus: controlProps.onFocus, onBlur: controlProps.onBlur }, tooltip }
}
