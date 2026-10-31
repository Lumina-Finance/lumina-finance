import { ApiError } from '@/api/auth'

/**
 * Names the exported file after the day it was made, in the user's profile timezone
 *
 * @param today - The day as "YYYY-MM-DD"
 */
export function getExportFilename(today: string): string {
  return `lumina-finance-transactions-${today}.csv`
}

/**
 * Says why the export is off, or returns undefined when it can run
 *
 * The export dialogue lets the person widen the list's filters, so an empty list only proves there is
 * nothing to export when no filter or search narrows it. A list still loading has not said yet
 * whether it is empty. A failed load leaves the button on, since the export asks the server on its own
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
  if (rowCount === 0 && !isNarrowed) return 'There are no transactions to export'
  return undefined
}

/** Said when the export fails with a server fault or no answer, since a status such as "Internal Server Error" never says the file wasn't saved */
export const EXPORT_FAILED_MESSAGE = 'Oops, something went wrong and nothing was downloaded. Please try again.'

/**
 * Says in words why the export failed, always making clear that nothing was saved
 *
 * A refusal the server explained, such as an expired session, keeps its own wording. A server fault or
 * a lost connection carries no explanation worth showing
 */
export function getExportFailureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status < 500 && error.message) return error.message
  return EXPORT_FAILED_MESSAGE
}

// Enough to hold the header row and the first line after it, however long the header is
const EXPORT_PEEK_BYTES = 2048

/**
 * Reports whether a downloaded file holds any transaction beyond its header row, from its first bytes
 *
 * Conditions that match nothing make a valid file of the header alone, which the dialogue refuses to
 * save
 */
export async function hasExportRows(file: Blob): Promise<boolean> {
  const start = await file.slice(0, EXPORT_PEEK_BYTES).text()

  // Reading a blob as text drops the byte order mark, so the first line is the header itself
  const lines = start.split('\r\n')
  return lines.length > 1 && lines[1] !== ''
}
