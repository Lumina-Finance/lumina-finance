import { ImportNotice, ImportRowProblemsTable, ImportRowWarningsTable } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { getSkippedRowsDisplay } from '@/pages/imports/utils'
import { ImportPreviewLayout } from './ImportPreviewLayout'

/**
 * Heads the reasons the import cannot go ahead
 *
 * Counted off the whole list rather than the part shown, since the list is capped and its last line
 * carries the remainder
 */
function getBlockingErrorsTitle(count: number) {
  return `We found ${count} error${count === 1 ? '' : 's'}`
}

type ImportPreviewStepProps = Pick<
  TransactionImportWorkflow,
  | 'files'
  | 'previewGroups'
  | 'importStats'
  | 'importBuild'
  | 'headers'
  | 'importError'
  | 'handleCommitImport'
  | 'canCommitImport'
  | 'importResult'
  | 'completedImport'
>

// How many reasons the step spells out before counting the rest. A file of unmatched categories
// produces one per category, each of them a blank dropdown already visible in the step it belongs
// to, so a full list would bury the preview to repeat what those steps show. The build puts column
// problems first, which is what the cap keeps
const VISIBLE_ERROR_LIMIT = 10

/**
 * Says how many reasons were left off the list
 *
 * Worded against the reasons rather than as a bare count, because the refused rows table in this
 * same step ends with its own overflow line counting rows, and two lines reading alike would leave
 * the numbers meaning whichever one the reader took first
 */
function getHiddenErrorSummary(count: number) {
  return `and ${count} more to answer`
}

/**
 * Preview and commit step of the generic CSV import flow, opening with the summary every import
 * shows, then a sample of the compiled transactions or, while anything still stands between the
 * mappings and a commit, the reasons instead
 *
 * Rows that can't be converted are listed above the sample with the reason each is left out, as the
 * imports from other apps list theirs, and the rest import without them. Rows that will import but
 * are probably not what the user meant are listed under them, and hold nothing up
 *
 * The reasons take the place of the sample rather than sitting over it, since a half-built preview
 * shown beside a list of reasons it is wrong invites reading it as the real result. They wait for a
 * file, so the step does not open by listing what the user has not done yet
 */
export function ImportPreviewStep({
  files,
  previewGroups,
  importStats,
  importBuild,
  headers,
  importError,
  handleCommitImport,
  canCommitImport,
  importResult,
  completedImport,
}: ImportPreviewStepProps) {
  const skipped = getSkippedRowsDisplay({ liveForecastRows: importBuild.rowProblems, completedImport })
  const visibleErrors = importBuild.errors.slice(0, VISIBLE_ERROR_LIMIT)
  const hiddenErrorCount = importBuild.errors.length - visibleErrors.length
  const hasBlockingErrors = files.length > 0 && importBuild.errors.length > 0

  return (
    <ImportPreviewLayout
      index="07"
      stats={importStats}
      blocked={hasBlockingErrors ? (
        <ImportNotice
          tone="danger"
          title={getBlockingErrorsTitle(importBuild.errors.length)}
          items={hiddenErrorCount > 0 ? [...visibleErrors, getHiddenErrorSummary(hiddenErrorCount)] : visibleErrors}
        />
      ) : undefined}
      previewGroups={previewGroups}
      emptyDescription="Mapped rows will appear here."
      importError={importError}
      imported={Boolean(importResult)}
      canCommit={canCommitImport}
      onCommit={handleCommitImport}
    >
      {skipped.totalCount > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={skipped.title}
            rowProblems={skipped.rows}
            headers={headers}
            toggleLabel="skipped rows"
          />
        </div>
      )}
      <ImportRowWarningsTable rowWarnings={importBuild.rowWarnings} headers={headers} />
      {/* Last of the three notices about the data, which run refusals first and then the things that
          hold nothing up. What follows is the preview itself rather than a fourth notice, so a red
          error list below this amber one is the body starting rather than the order breaking */}
      {importBuild.warnings.map((warning) => (
        <p key={warning} className="mb-4 text-sm font-medium" style={{ color: 'var(--app-warning-text)' }}>
          {warning}
        </p>
      ))}
    </ImportPreviewLayout>
  )
}
