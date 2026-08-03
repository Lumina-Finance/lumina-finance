import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportCommitPanelProps = Pick<
  TransactionImportWorkflow,
  'importBuild' | 'importError' | 'handleCommitImport' | 'canCommitImport' | 'importResult'
>

// Named rather than counted, because a row problem is listed in the preview step with the row it
// belongs to and this panel would otherwise repeat all of it
const ROWS_TO_FIX_MESSAGE = 'Some rows cannot be imported. The preview step lists them with the reason for each.'

// How many unanswered questions the panel spells out before counting the rest. A file of unmatched
// categories produces one for each, and every one of them is a blank dropdown already visible in
// the step it belongs to, so a full list would push the button off the page to say what the steps
// above already show
const VISIBLE_ERROR_LIMIT = 5

/**
 * Commit panel for the generic CSV import flow, listing what still stands between the mappings and
 * a commit, above the button that starts one
 */
export function ImportCommitPanel({
  importBuild,
  importError,
  handleCommitImport,
  canCommitImport,
  importResult,
}: ImportCommitPanelProps) {
  const visibleErrors = importBuild.errors.slice(0, VISIBLE_ERROR_LIMIT)
  const hiddenErrorCount = importBuild.errors.length - visibleErrors.length

  return (
    <div className="flex flex-col items-end gap-3 pb-1">
      {visibleErrors.map((error) => (
        <p key={error} className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      ))}
      {hiddenErrorCount > 0 && (
        <p className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {`and ${hiddenErrorCount} more`}
        </p>
      )}
      {importBuild.rowProblems.length > 0 && (
        <p className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {ROWS_TO_FIX_MESSAGE}
        </p>
      )}
      {importError && (
        <p role="alert" className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {importError}
        </p>
      )}
      <button
        type="button"
        className="app-primary-button"
        onClick={handleCommitImport}
        disabled={!canCommitImport}
      >
        {importResult ? 'Imported' : 'Commit import'}
      </button>
    </div>
  )
}
