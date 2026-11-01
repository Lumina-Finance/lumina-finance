import { ApiError } from '@/api/auth'

/**
 * Names the exported file after the day it was made, in the user's profile timezone
 *
 * @param today - The day as "YYYY-MM-DD"
 */
export function getExportFilename(today: string): string {
  return `lumina-finance-transactions-${today}.csv`
}

/** What the export button would save: everything, what the search and filters keep, or the ticked rows */
export type ExportScope = 'all' | 'filtered' | 'selected'

/** The toolbar button's word for each scope, which follows what the list is showing */
export const EXPORT_LABELS: Record<ExportScope, string> = {
  all: 'Export all',
  filtered: 'Export filtered',
  selected: 'Export selected',
}

/**
 * Picks what the export saves from how the list is narrowed
 *
 * Ticked rows win over the search and filters, since the person picked those rows out of the filtered
 * list on purpose
 *
 * @param selectedCount - How many rows are ticked
 * @param isNarrowed - Whether a submitted search or any filter, a date filter included, is on
 */
export function getExportScope({
  selectedCount,
  isNarrowed,
}: {
  selectedCount: number
  isNarrowed: boolean
}): ExportScope {
  if (selectedCount > 0) return 'selected'
  return isNarrowed ? 'filtered' : 'all'
}

/**
 * Says why the export is off, or returns undefined when it can run
 *
 * An empty list has nothing to export, whether nothing exists or the search and filters keep nothing.
 * A list still loading has not said yet whether it is empty. A failed load leaves the button on, since
 * the export asks the server on its own
 */
export function getExportBlockReason({
  isLoaded,
  hasError,
  rowCount,
  isNarrowed,
}: {
  isLoaded: boolean
  hasError: boolean
  rowCount: number
  isNarrowed: boolean
}): string | undefined {
  if (hasError) return undefined
  if (!isLoaded) return 'Transactions are still loading'
  if (rowCount === 0)
    return isNarrowed ? 'No transactions match the search or filters' : 'There are no transactions to export'
  return undefined
}

/** Said when the export fails with a server fault or no answer, since a status such as "Internal Server Error" never says the file wasn't saved */
export const EXPORT_FAILED_MESSAGE = 'Oops, something went wrong and nothing was downloaded. Please try again.'

/**
 * Says in words why the export failed, always making clear that nothing was saved
 *
 * A refusal the server explained, such as an expired session or a ticked row deleted elsewhere, gives its
 * reason after saying nothing was downloaded. A server fault or a lost connection carries no explanation
 * worth showing
 */
export function getExportFailureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status < 500 && error.message) {
    const reason = /^[A-Z][a-z]/.test(error.message)
      ? error.message.charAt(0).toLowerCase() + error.message.slice(1)
      : error.message
    return `Nothing was downloaded: ${reason}`
  }
  return EXPORT_FAILED_MESSAGE
}
