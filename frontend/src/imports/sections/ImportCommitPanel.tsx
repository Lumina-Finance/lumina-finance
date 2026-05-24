import type { TransactionImportWorkflow } from '../hooks'

type ImportCommitPanelProps = Pick<
  TransactionImportWorkflow,
  'importBuild' | 'importError' | 'handleCommitImport' | 'canCommitImport' | 'importResult'
>

export function ImportCommitPanel({
  importBuild,
  importError,
  handleCommitImport,
  canCommitImport,
  importResult,
}: ImportCommitPanelProps) {
  return (
    <div className="flex flex-col items-end gap-3 pb-1">
      {importBuild.errors.length > 0 && (
        <p className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {importBuild.errors[0]}
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
