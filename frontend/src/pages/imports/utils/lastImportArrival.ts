import type { LastImport } from '@/api/import-runs'

/**
 * What the page knows of the last import arriving or changing under it
 *
 * `count` rises with each arrival, so the page can act on every one and not only the first, and
 * `entry` is the import that arrived
 */
export type LastImportArrivalTracker = {
  /** Whether the first read of this visit has settled, which is the import the page opened with */
  isBaselined: boolean
  /** The import the card showed at the last look, null while it showed none */
  shownId: string | null
  count: number
  entry: LastImport | null
}

export const INITIAL_LAST_IMPORT_ARRIVAL: LastImportArrivalTracker = {
  isBaselined: false,
  shownId: null,
  count: 0,
  entry: null,
}

/**
 * Moves the tracker on for one look at the card's import, and gives back the same object when
 * nothing changed
 *
 * The import the page opens with is only remembered, so it is never an arrival, and neither is one
 * the card is read as showing before this visit's own read has settled, which can be a saved copy.
 * After that, an import is an arrival when it is not the one the card showed before, unless it is
 * the import this tab saved itself. An import going is no arrival: the page already reopens it
 * when it was undone elsewhere
 *
 * @param tracker - What the page knew before
 * @param look - Whether this visit's own read has settled, the import the card shows (null for none)
 *   and the run this tab's own finished importer saved
 */
export function trackLastImportArrival(
  tracker: LastImportArrivalTracker,
  look: { isSettled: boolean; entry: LastImport | null; ownRunId: string | null },
): LastImportArrivalTracker {
  if (!look.isSettled) return tracker
  const entryId = look.entry?.id ?? null
  if (!tracker.isBaselined) return { ...tracker, isBaselined: true, shownId: entryId }
  if (entryId === tracker.shownId) return tracker
  const isArrival = look.entry !== null && entryId !== look.ownRunId
  return {
    ...tracker,
    shownId: entryId,
    ...(isArrival && { count: tracker.count + 1, entry: look.entry }),
  }
}
