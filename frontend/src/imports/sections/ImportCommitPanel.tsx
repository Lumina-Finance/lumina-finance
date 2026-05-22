import ActionFeedbackButton from '@/components/ActionFeedbackButton'
import type { TransactionImportWorkflow } from '../hooks'

type ImportCommitPanelProps = Pick<
  TransactionImportWorkflow,
  'importBuild' | 'importError' | 'importSummary' | 'importFeedback' | 'handleCommitImport' | 'canCommitImport' | 'importResult'
>

export function ImportCommitPanel({
  importBuild,
  importError,
  importSummary,
  importFeedback,
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
      {importSummary && (
        <p role="status" className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-positive)' }}>
          {importSummary}
        </p>
      )}
      <ActionFeedbackButton
        type="button"
        className="app-primary-button"
        status={importFeedback.status}
        loadingLabel="Importing"
        successLabel="Imported"
        onClick={handleCommitImport}
        disabled={!canCommitImport}
      >
        {importResult ? 'Imported' : 'Commit import'}
      </ActionFeedbackButton>
    </div>
  )
}
