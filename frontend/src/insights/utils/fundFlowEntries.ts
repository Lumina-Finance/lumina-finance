import type { FundFlowEntry } from '@/insights/types/fundFlow'

function getEntryKey([name, amount]: FundFlowEntry) {
  return `${name}\u0000${amount}`
}

/**
 * Removes matching reversed entries without dropping duplicate categories incorrectly
 */
export function withoutMatchingEntries(entries: FundFlowEntry[], exclusions: FundFlowEntry[]) {
  const remainingExclusions = new Map<string, number>()
  for (const entry of exclusions) {
    const key = getEntryKey(entry)
    remainingExclusions.set(key, (remainingExclusions.get(key) ?? 0) + 1)
  }

  return entries.filter((entry) => {
    const key = getEntryKey(entry)
    const count = remainingExclusions.get(key) ?? 0
    if (count === 0) return true
    remainingExclusions.set(key, count - 1)
    return false
  })
}
