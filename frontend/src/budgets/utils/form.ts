
export function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const values = new Set(a)
  return b.every((value) => values.has(value))
}
