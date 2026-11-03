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

// Said when the session is gone, whatever token detail the server gave, since only signing in again helps
const EXPORT_SESSION_EXPIRED_REASON = 'your session has expired. Please sign in again.'

// What a refusal that arrives with no explanation means, as a proxy in front of the server sends it.
// The server itself always explains its refusals, so only these statuses have a known cause to name
const EXPORT_REASONS_BY_STATUS: Record<number, string> = {
  403: "you don't have permission to export.",
  404: "the transactions couldn't be found. Please refresh the list and try again.",
  408: 'the request took too long. Please try again.',
  413: 'the request was too large. Please select fewer transactions or narrow the filters and try again.',
  429: 'too many requests were sent. Please wait a moment and try again.',
}

// Said for any other refusal with no explanation, since a 4xx always means the server saw the request
const EXPORT_REFUSED_REASON = 'the request was refused. Please refresh the page and try again.'

/**
 * Says in words why the export failed, always making clear that nothing was saved
 *
 * A refusal the server explained gives its reason after saying nothing was downloaded, and so does one
 * naming refused fields, in the sentence built from them. A refusal with no explanation gives the
 * reason its status stands for, or says the request was refused. Only a server fault or a lost
 * connection gets the plain message, which is never joined to the "Nothing was downloaded" prefix
 */
export function getExportFailureMessage(error: unknown): string {
  if (!(error instanceof ApiError) || error.status >= 500) return EXPORT_FAILED_MESSAGE
  const message =
    error.status === 401
      ? EXPORT_SESSION_EXPIRED_REASON
      : (error.detail ??
        (error.fieldErrors
          ? error.message.replace(/^Oops, /, '')
          : (EXPORT_REASONS_BY_STATUS[error.status] ?? EXPORT_REFUSED_REASON)))
  const reason = /^[A-Z][a-z]/.test(message) ? message.charAt(0).toLowerCase() + message.slice(1) : message
  return `Nothing was downloaded: ${reason}`
}
