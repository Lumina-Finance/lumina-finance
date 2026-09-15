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
