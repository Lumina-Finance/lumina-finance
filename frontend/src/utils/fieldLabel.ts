/**
 * Builds the id of a field's visible label from the id of the field itself
 *
 * A drop-down's control is a button, and a label element does not give a button its accessible name
 * the way it does an input, so the button has to point back at the label by id. Both sides derive
 * that id from here rather than each writing the same suffix.
 *
 * @param fieldId - The id carried by the control the label belongs to
 */
export function getFieldLabelId(fieldId: string): string {
  return `${fieldId}-label`
}
