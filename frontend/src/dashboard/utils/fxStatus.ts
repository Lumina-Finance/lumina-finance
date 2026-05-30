import type { FxRateIssue, FxStatus } from '@/api/dashboard'

export function formatMissingFxPairs(missingPairs: FxRateIssue[]) {
  const distinctPairs = Array.from(new Set(missingPairs.map((pair) => `${pair.base}/${pair.quote}`)))
  const visiblePairs = distinctPairs.slice(0, 3)
  const remainingCount = distinctPairs.length - visiblePairs.length
  return remainingCount > 0
    ? `${visiblePairs.join(', ')} and ${remainingCount} more`
    : visiblePairs.join(', ')
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
  return fxStatus?.state === 'complete' ? 'blue' : 'red'
}
