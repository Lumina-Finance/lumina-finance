import { useDisabledReason } from '@/hooks/useDisabledReason'

/**
 * Shows a read-only reason on keyboard focus of the control a row or card already offers, in place of a
 * focusable pill, so the row keeps a single tab stop
 *
 * Spread `focusProps` on that control and draw `tooltip` beside it. The reason sits beside the control,
 * or beside the box its `data-reason-beside` selector names. Only focus shows it, since the pill already
 * answers the pointer, and the control stays enabled, unmarked and described by the pill named by
 * `pillId`, so a screen reader hears no second copy
 *
 * @param reason - The reason, or nothing while the record can change or another reason holds the control
 * @param pillId - The id of the pill showing the same reason on the row
 */
export function useReadOnlyReasonOnFocus(reason: string | null | undefined, pillId: string) {
  const { controlProps, tooltip } = useDisabledReason(reason, pillId)
  return { focusProps: { onFocus: controlProps.onFocus, onBlur: controlProps.onBlur }, tooltip }
}
