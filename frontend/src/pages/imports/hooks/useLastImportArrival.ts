import { useState } from 'react'
import { useLastImport } from '@/api/import-runs'
import { useUndoableEntry } from '@/pages/imports/hooks/useUndoableEntry'
import { INITIAL_LAST_IMPORT_ARRIVAL, trackLastImportArrival } from '@/pages/imports/utils/lastImportArrival'

/**
 * Tells the page when the "Last import" card gets an import this tab did not save, because another
 * tab committed one while this page was open
 *
 * @param ownRunId - The run this tab's own finished importer saved, which is no arrival, or null
 * @returns The arrivals so far and the latest import, for the page to bring its setup panel into
 *   view, flash the card and say so to a screen reader
 */
export function useLastImportArrival(ownRunId: string | null) {
  const lastImport = useLastImport()
  const entry = useUndoableEntry(lastImport.data ?? null)

  // Set while rendering, as the page does for its other derived state. Settled only on a successful
  // read of this visit, so a saved copy or a failed read never stands in for what the page opened with
  const [tracker, setTracker] = useState(INITIAL_LAST_IMPORT_ARRIVAL)
  const next = trackLastImportArrival(tracker, {
    isSettled: lastImport.isSuccess && lastImport.isFetchedAfterMount,
    entry,
    ownRunId,
  })
  if (next !== tracker) setTracker(next)

  return { arrivalCount: next.count, arrivedEntry: next.entry }
}
