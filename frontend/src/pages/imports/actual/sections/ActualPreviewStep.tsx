import { EmptyState, ImportPreviewList, ImportStat, ImportStep } from '@/pages/imports/components'
import { ActualSkippedRowsTable } from '@/pages/imports/actual/components'
import { ACTUAL_SAMPLE_PREVIEW_LIMIT, ACTUAL_TRANSACTION_DECIMALS } from '@/pages/imports/actual/constants'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'

type ActualPreviewStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'importEstimate'
  | 'previewRows'
  | 'previewGroups'
  | 'predictedSkippedRows'
  | 'completedImport'
  | 'newAccountCount'
  | 'newCategoryCount'
  | 'importBuild'
  | 'importError'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
>

/**
 * Preview and commit step of the Actual Budget import flow, showing a sample of the transactions
 * the commit will create, the rows it leaves out and why, and the button that starts the commit
 */
export function ActualPreviewStep({
  budget,
  importEstimate,
  previewRows,
  previewGroups,
  predictedSkippedRows,
  completedImport,
  newAccountCount,
  newCategoryCount,
  importBuild,
  importError,
  importResult,
  canCommitImport,
  handleCommitImport,
}: ActualPreviewStepProps) {
  // Once the import has run, the rows it left out are the ones it was started with
  const skippedRows = completedImport?.skippedRowsAtCommit ?? predictedSkippedRows
  const skippedCount = skippedRows.length
  const plural = skippedCount === 1 ? '' : 's'
  const skippedTitle = completedImport
    ? `${skippedCount} row${plural} ${skippedCount === 1 ? 'was' : 'were'} not imported`
    : `${skippedCount} row${plural} will not be imported`

  return (
    <ImportStep
      // The budget step only exists once an export is staged, so the steps after it close the gap
      index={budget ? '05' : '04'}
      title="Preview and Commit"
      description={`Showing the first ${ACTUAL_SAMPLE_PREVIEW_LIMIT} transactions as they will appear in your ledger.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows" value={importEstimate.rowCount.toString()} />
        <ImportStat label="Will Create" value={importEstimate.transactionEstimate.toString()} />
        <ImportStat label="New Accounts" value={newAccountCount.toString()} />
        <ImportStat label="New Categories" value={newCategoryCount.toString()} />
      </div>

      {skippedCount > 0 && <ActualSkippedRowsTable title={skippedTitle} rows={skippedRows} decimals={budget?.budgetDecimals ?? ACTUAL_TRANSACTION_DECIMALS} />}

      {previewRows.length === 0 ? (
        <EmptyState title="No preview rows" description="Transactions compiled from the export will appear here." />
      ) : (
        <ImportPreviewList groups={previewGroups} />
      )}

      <div className="flex flex-col items-end gap-3 pt-2">
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
    </ImportStep>
  )
}
