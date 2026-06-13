import type { FxRateIssue, FxStatus } from '@/api/shared/fx'

export function formatMissingFxPairs(missingPairs: FxRateIssue[]) {
  const distinctPairs = Array.from(new Set(missingPairs.map((pair) => `${pair.base}/${pair.quote}`)))
  const visiblePairs = distinctPairs.slice(0, 3)
  const remainingCount = distinctPairs.length - visiblePairs.length
  return remainingCount > 0
    ? `${visiblePairs.join(', ')} and ${remainingCount} more`
    : visiblePairs.join(', ')
}

export function combineFxStatuses(statuses: Array<FxStatus | undefined | null>): FxStatus {
  const activeStatuses = statuses.filter((status): status is FxStatus => status != null && status.state !== 'none')

  if (activeStatuses.length === 0) return { state: 'none', missing_pairs: [] }

  const missingPairKeys = new Set<string>()
  const missingPairs = activeStatuses.flatMap((status) => status.missing_pairs).filter((pair) => {
    const key = `${pair.base}/${pair.quote}`
    if (missingPairKeys.has(key)) return false
    missingPairKeys.add(key)
    return true
  })

  if (missingPairs.length === 0) return { state: 'complete', missing_pairs: [] }
  return {
    state: activeStatuses.every((status) => status.state === 'unavailable') ? 'unavailable' : 'incomplete',
    missing_pairs: missingPairs,
  }
}

export function getFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'FX not used. No foreign currency conversion was needed.'
    case 'complete':
      return 'Foreign currency conversion applied'
    case 'incomplete':
      return 'FX incomplete. Some foreign currency values could not be converted.'
    case 'unavailable':
      return 'FX unavailable. Foreign currency values could not be converted.'
  }
}

export function getFxStatusTone(fxStatus: FxStatus | undefined) {
  if (fxStatus?.state === 'complete') return 'blue'
  if (fxStatus?.state === 'none') return 'gray'
  return 'red'
}
