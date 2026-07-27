/**
 * Returns a copy of a record without the given key, or the original record when the key was never
 * present, so state that did not actually change keeps the same identity and skips a re-render
 */
export function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

/**
 * Returns a copy of a set without the given value, or the original set when the value was never in
 * it, so state that did not actually change keeps the same identity and skips a re-render
 */
export function removeSetValue<T>(set: Set<T>, value: T) {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

/**
 * Collects the distinct values from a list in the order they first appear, dropping empty strings so
 * blank cells in an imported file never become an option the user can pick
 */
export function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

/**
 * Renders a file size for display, stepping up from bytes to kilobytes to megabytes in units of 1024
 * and keeping one decimal place above the byte range
 */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

