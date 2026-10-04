import type { ImportRunBudgets, JournalImportRunResponse } from '@/api/provider-imports'
import { getJsonByteSize } from '@/api/shared/importBatchSize'
import { joinImportSummaryParts } from '@/pages/imports/utils/common'
import type { CompletedImport } from '@/pages/imports/utils/importRun'

/** What the overlay calls the upload of an export from another app */
export const PROVIDER_IMPORT_UPLOAD_LABEL = 'Uploading the export'

/**
 * Largest budgets request an import sends, kept under the server's 10 MiB request limit with room
 * for the rest of the request, so a selection too large to send is refused before anything uploads
 */
export const PROVIDER_MAX_BUDGETS_REQUEST_BYTES = 9 * 1024 * 1024

/**
 * Builds the budgets a provider import creates alongside its rows, or the reason it can't. Built
 * ahead of the import so a budget it cannot send is refused while the selection can still change
 */
export function buildProviderRunBudgets(build: () => ImportRunBudgets): { budgets: ImportRunBudgets | null; error: string | null } {
  try {
    const budgets = build()

    // The budgets go in one request, and a request past the server's limit is refused whole
    if (getJsonByteSize(budgets) > PROVIDER_MAX_BUDGETS_REQUEST_BYTES) {
      return { budgets: null, error: 'The selected budgets are too large to import at once. Select fewer budgets.' }
    }
    return { budgets, error: null }
  } catch (error) {
    return { budgets: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Why the selected budgets can't be imported, if they can't. The importer takes a bounded number of
 * budgets, and its refusal would name none of them
 */
export function getProviderBudgetSelectionError(selectedCount: number, maxBudgets: number, buildError: string | null) {
  return selectedCount > maxBudgets
    ? `Select at most ${maxBudgets.toLocaleString()} budgets to import, since the importer takes up to that many at once.`
    : buildError
}

/**
 * Selects the skipped rows the preview shows, with its title. Once the import has run, they are the
 * rows it was started with, since later answers no longer change what it wrote
 *
 * The weekly checks read the title after the import, so its wording is theirs to match
 */
export function getProviderSkippedRowsDisplay<TSkipped>({
  liveForecastRows,
  completedImport,
}: {
  liveForecastRows: TSkipped[]
  completedImport: CompletedImport<JournalImportRunResponse, TSkipped> | null
}) {
  const rows = completedImport?.skippedRowsAtCommit ?? liveForecastRows
  const totalCount = rows.length
  const plural = totalCount === 1 ? '' : 's'
  return {
    rows,
    totalCount,
    title: completedImport
      ? `${totalCount} row${plural} ${totalCount === 1 ? 'was' : 'were'} not imported`
      : `${totalCount} row${plural} will not be imported`,
  }
}

/**
 * Counts the sources answered create-new that the import sends, since the commit creates nothing
 * for a source it leaves out
 */
export function countCreatedImportSources(
  sources: string[],
  mappings: Record<string, string>,
  createValue: string,
  writtenSources: ReadonlySet<string>,
) {
  return sources.filter((source) => mappings[source] === createValue && writtenSources.has(source)).length
}

/**
 * Formats the import result into the overlay summary line
 *
 * Budgets and archived accounts only join the line when the commit wrote some, so an import
 * without them reads as a transactions import alone
 *
 * @param result - What the commit wrote
 * @param skippedCount - Rows the browser left out because they cannot be written
 */
export function formatProviderImportSummary(result: JournalImportRunResponse, skippedCount: number) {
  const parts = [
    `${result.rows_imported} row${result.rows_imported === 1 ? '' : 's'} imported`,
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} created`,
    `${skippedCount} skipped`,
  ]
  if (result.budgets_created > 0) {
    parts.push(`${result.budgets_created} budget${result.budgets_created === 1 ? '' : 's'} imported`)
  }
  if (result.accounts_archived > 0) {
    parts.push(`${result.accounts_archived} account${result.accounts_archived === 1 ? '' : 's'} archived`)
  }

  return joinImportSummaryParts(parts)
}
