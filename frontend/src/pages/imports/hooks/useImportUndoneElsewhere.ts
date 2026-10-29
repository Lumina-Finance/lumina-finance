import { useEffect, useState } from 'react'
import { useIsImportRunSaved, useLastImport, type LastImport } from '@/api/import-runs'

/**
 * Tells the page when the import a finished importer on it saved was undone in another tab
 *
 * The last import going is not proof: any other change to the user's data, or the end of its undo
 * window, takes it away too and leaves the import saved. So once this tab has seen the import as
 * the last one and finds it is not any more, it asks whether the import's run is still there. The
 * run stays after a later import replaces it and goes only when the import is undone or its window
 * ends, so its absence is an undo while the window this tab saw it with is still open
 *
 * @param heldRunId - The run the finished importer saved, null while none holds a finished import
 * @param onUndone - Told the run that was undone, for the page to put its importers right
 */
export function useImportUndoneElsewhere(heldRunId: string | null, onUndone: (runId: string) => void) {
  const lastImport = useLastImport()

  // Kept from the last time the import was seen as the last one, since the undo window it ends
  // with is read from it. Set while rendering, as the page does for its other derived state
  const [seen, setSeen] = useState<LastImport | null>(null)
  if (heldRunId !== null && lastImport.data?.id === heldRunId && seen !== lastImport.data) setSeen(lastImport.data)

  const isLastImportOther = lastImport.isSuccess && !lastImport.isFetching && lastImport.data?.id !== heldRunId
  const askedRun = seen !== null && seen.id === heldRunId && isLastImportOther ? seen : null
  const isSaved = useIsImportRunSaved(askedRun?.id ?? null)

  useEffect(() => {
    if (askedRun === null || isSaved.data !== false) return
    if (Date.now() < new Date(askedRun.undo_until).getTime()) onUndone(askedRun.id)
  }, [askedRun, isSaved.data, onUndone])
}
