import { useEffect, useState } from 'react'
import type { BankImportProgress, BankLinkState } from '@/api/bank-sync'

// How long a finished import stays on screen as done before it folds away
const DONE_HOLD_MS = 1500

/**
 * The import to show, which outlives the import for a moment so it can be seen finishing. Once a link
 * that still syncs stops reporting an import, the import is taken to have finished, so the last one read
 * is held as complete, all its windows done, then dropped. A link whose bank account must be chosen again stops
 * reporting its import too, but that import was cut short, so it goes at once without reading as done
 */
export function useLingeringImport(
  current: BankImportProgress | null,
  linkState: BankLinkState,
): BankImportProgress | null {
  const [shown, setShown] = useState<BankImportProgress | null>(current)

  // Adjusted during render rather than in an effect, so the shown import never lags a read behind
  if (current && shown !== current) setShown(current)
  if (!current && shown && shown.state !== 'complete') {
    setShown(linkState === 'active' ? { ...shown, state: 'complete', windows_done: shown.windows_total } : null)
  }

  useEffect(() => {
    if (shown?.state !== 'complete') return undefined
    const timer = window.setTimeout(() => setShown(null), DONE_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [shown])

  return shown
}
