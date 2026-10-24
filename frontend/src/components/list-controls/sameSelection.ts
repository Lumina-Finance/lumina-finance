/**
 * Returns whether two lists of chosen values hold the same values, in any order, with a missing list
 * counting as an empty one
 */
export function isSameSelection(first: readonly string[] | undefined, second: readonly string[] | undefined): boolean {
  const left = new Set(first ?? [])
  const right = new Set(second ?? [])
  return left.size === right.size && [...left].every((value) => right.has(value))
}
