/**
 * Compares string selections as sets because category IDs should be unique before they reach the form
 */
export function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const values = new Set(a)
  return b.every((value) => values.has(value))
}

/**
 * Id of the validation message a budget editor's label row shows for a field, which the field names as its
 * description
 */
export function budgetFieldErrorId(fieldId: string) {
  return `${fieldId}-error`
}
