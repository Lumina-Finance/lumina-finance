import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportCommitPanelProps = Pick<
  TransactionImportWorkflow,
  'importBuild' | 'importError' | 'handleCommitImport' | 'canCommitImport' | 'importResult'
>

// Named rather than counted, because a row problem is listed in the preview step with the row it
// belongs to and this panel would otherwise repeat all of it
const ROWS_TO_FIX_MESSAGE = 'Some rows cannot be imported. The preview step lists them with the reason for each.'

/**
 * Commit panel for the generic CSV import flow, listing every payload-build error and any import
 * error above the button that starts the commit
 */
export function ImportCommitPanel({
  importBuild,
  importError,
  handleCommitImport,
  canCommitImport,
  importResult,
}: ImportCommitPanelProps) {
  return (
    <div className="flex flex-col items-end gap-3 pb-1">
      {importBuild.errors.map((error) => (
        <p key={error} className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      ))}
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
