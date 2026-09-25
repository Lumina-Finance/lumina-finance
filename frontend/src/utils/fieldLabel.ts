/**
 * Builds the id of a field's visible label from the id of the field itself
 *
 * Callers use this shared id when a control points to an existing or composite visible label with
 * aria-labelledby. A simple fixed field can instead connect its label with htmlFor
 *
 * @param fieldId - The id carried by the control the label belongs to
 */
export function getFieldLabelId(fieldId: string): string {
  return `${fieldId}-label`
}

/**
 * Brings a segmented control's chosen option into focus from its visible label, or its first option
 * while none is chosen, without pressing it
 *
 * A label names a single control, and pointing it at one option would both rename that option and
 * pick it on a click. So these labels leave htmlFor out and move focus themselves, asking for the focus
 * ring a browser would otherwise leave off after a mouse click. A disabled option takes no focus, as it
 * would from a native label
 *
 * @param groupId - The id carried by the element holding the options
 */
export function focusChosenOption(groupId: string): void {
  const group = document.getElementById(groupId)
  const option = group?.querySelector<HTMLButtonElement>('.app-segmented-option-active')
    ?? group?.querySelector<HTMLButtonElement>('button')
  option?.focus({ focusVisible: true })
}
