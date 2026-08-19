import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportCommitPanelProps = Pick<
  TransactionImportWorkflow,
  'importError' | 'handleCommitImport' | 'canCommitImport' | 'importResult'
>

/**
 * Commit panel for the generic CSV import flow, holding the button and the reason a commit that was
 * actually attempted came back refused
 *
 * Everything the import knows before the button is pressed is shown in the preview step above,
 * against the rows and columns it is about, so nothing here repeats it
 */
export function ImportCommitPanel({
  importError,
  handleCommitImport,
  canCommitImport,
  importResult,
}: ImportCommitPanelProps) {
  return (
    <div className="flex flex-col items-end gap-3 pb-1">
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
