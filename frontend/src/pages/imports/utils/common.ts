export function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export function removeSetValue<T>(set: Set<T>, value: T) {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

export function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

