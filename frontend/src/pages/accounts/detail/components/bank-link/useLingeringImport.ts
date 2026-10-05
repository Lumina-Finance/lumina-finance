import { useEffect, useState } from 'react'
import type { BankImportProgress } from '@/api/bank-sync'

// How long a finished import stays on screen as done before it folds away
const DONE_HOLD_MS = 1500

/**
 * The import to show, which outlives the import for a moment so it can be seen finishing. Once the
 * link stops reporting an import, the last one read is held as complete, all its windows done, then
 * dropped
 */
export function useLingeringImport(current: BankImportProgress | null): BankImportProgress | null {
  const [shown, setShown] = useState<BankImportProgress | null>(current)

  // Adjusted during render rather than in an effect, so the shown import never lags a read behind
  if (current && shown !== current) setShown(current)
  if (!current && shown && shown.state !== 'complete') setShown({ ...shown, state: 'complete', windows_done: shown.windows_total })

  useEffect(() => {
    if (shown?.state !== 'complete') return undefined
    const timer = window.setTimeout(() => setShown(null), DONE_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [shown])

  return shown
}
