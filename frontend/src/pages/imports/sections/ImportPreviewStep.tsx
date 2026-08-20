import { EmptyState, ImportNotice, ImportPreviewList, ImportRowProblemsTable, ImportStep } from '@/pages/imports/components'
import { IMPORT_SAMPLE_PREVIEW_LIMIT } from '@/pages/imports/constants'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

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
  'files' | 'previewRows' | 'previewGroups' | 'importBuild' | 'headers'
>

// How many reasons the step spells out before counting the rest. A file of unmatched categories
// produces one per category, each of them a blank dropdown already visible in the step it belongs
// to, so a full list would bury the preview to repeat what those steps show. The build puts column
// problems first, which is what the cap keeps
const VISIBLE_ERROR_LIMIT = 10

/**
 * Builds the heading over the rows that cannot be converted, which says what has to happen rather
 * than only how many there are
 */
function getRowProblemsTitle(count: number) {
  return `${count} row${count === 1 ? '' : 's'} must be fixed before importing`
}

/**
 * Builds the heading over the rows that import as they are but are worth a second look
 *
 * It offers a look rather than stating a fault, since nothing is wrong with these rows. That they
 * are taken is left to the note against each one, which the heading cannot also carry without
 * reading like the refusal heading above it
 */
function getRowWarningsTitle(count: number) {
  return `${count} row${count === 1 ? '' : 's'} worth a look`
}

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
 * Preview step of the generic CSV import flow, showing a sample of the compiled transactions or,
 * while anything still stands between the mappings and a commit, the reasons instead
 *
 * Rows that cannot be converted are listed above the sample with the reason each was refused, and
 * the import stays refused until every one of them is gone. Rows that will import but are probably
 * not what the user meant are listed under them, and hold nothing up
 *
 * The reasons take the place of the sample rather than sitting over it, since a half-built preview
 * shown beside a list of reasons it is wrong invites reading it as the real result. They wait for a
 * file, so the step does not open by listing what the user has not done yet
 */
export function ImportPreviewStep({
  files,
  previewRows,
  previewGroups,
  importBuild,
  headers,
}: ImportPreviewStepProps) {
  const visibleErrors = importBuild.errors.slice(0, VISIBLE_ERROR_LIMIT)
  const hiddenErrorCount = importBuild.errors.length - visibleErrors.length
  const hasBlockingErrors = files.length > 0 && importBuild.errors.length > 0

  return (
    <ImportStep
      index="07"
      title="Imported Data Preview"
      description={`The first ${IMPORT_SAMPLE_PREVIEW_LIMIT} transactions as they will appear in your ledger.`}
    >
      {importBuild.rowProblems.length > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={getRowProblemsTitle(importBuild.rowProblems.length)}
            rowProblems={importBuild.rowProblems}
            headers={headers}
          />
        </div>
      )}
      {importBuild.rowWarnings.length > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={getRowWarningsTitle(importBuild.rowWarnings.length)}
            rowProblems={importBuild.rowWarnings}
            headers={headers}
            toggleLabel="rows worth a look"
            tone="warning"
            reasonHeader="Note"
          />
        </div>
      )}
      {/* Last of the three notices about the data, which run refusals first and then the things that
          hold nothing up. What follows is the preview itself rather than a fourth notice, so a red
          error list below this amber one is the body starting rather than the order breaking */}
      {importBuild.warnings.map((warning) => (
        <p key={warning} className="mb-4 text-sm font-medium" style={{ color: 'var(--app-warning-text)' }}>
          {warning}
        </p>
      ))}
      {hasBlockingErrors ? (
        <ImportNotice
          tone="danger"
          title={getBlockingErrorsTitle(importBuild.errors.length)}
          items={hiddenErrorCount > 0 ? [...visibleErrors, getHiddenErrorSummary(hiddenErrorCount)] : visibleErrors}
        />
      ) : previewRows.length === 0 ? (
        <EmptyState
          title="No preview rows"
          description="Mapped rows will appear here."
        />
      ) : (
        <ImportPreviewList groups={previewGroups} />
      )}
    </ImportStep>
  )
}
