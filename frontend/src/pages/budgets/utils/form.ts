/**
 * Compares string selections as sets because category IDs should be unique before they reach the form
 */
export function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const values = new Set(a)
  return b.every((value) => values.has(value))
}
