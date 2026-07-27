import { EmptyState, ImportPreviewList, ImportStat, ImportStep } from '@/pages/imports/components'
import { FireflySkippedRowsTable } from '@/pages/imports/firefly/components'
import { FIREFLY_SAMPLE_PREVIEW_LIMIT } from '@/pages/imports/firefly/constants'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'

type FireflyPreviewStepProps = Pick<
  FireflyImportWorkflow,
  | 'importEstimate'
  | 'previewRows'
  | 'previewGroups'
  | 'predictedSkippedRows'
  | 'fireflyHeaders'
  | 'newAccountCount'
  | 'newCategoryCount'
  | 'budgetsFile'
  | 'importBuild'
  | 'importError'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
>

/**
 * Preview and commit step of the Firefly III import flow, showing a sample of the transactions the
 * commit will create, any rows it will skip, and the button that starts the commit
 *
 * The step number shifts by one depending on whether a budgets export is staged, since the budget
 * step before it only exists when there is one
 */
export function FireflyPreviewStep({
  importEstimate,
  previewRows,
  previewGroups,
  predictedSkippedRows,
  fireflyHeaders,
  newAccountCount,
  newCategoryCount,
  budgetsFile,
  importBuild,
  importError,
  importResult,
  canCommitImport,
  handleCommitImport,
}: FireflyPreviewStepProps) {
  const skippedCount = predictedSkippedRows.length

  return (
    <ImportStep
      // The budget step only exists when a budgets export is staged, so the
      // steps after it close the gap when there is none
      index={budgetsFile ? '05' : '04'}
      title="Preview and Commit"
      description={`Showing the first ${FIREFLY_SAMPLE_PREVIEW_LIMIT} transactions as they will appear in your ledger.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows" value={importEstimate.rowCount.toString()} />
        <ImportStat label="Will Create" value={importEstimate.transactionEstimate.toString()} />
        <ImportStat label="New Accounts" value={newAccountCount.toString()} />
        <ImportStat label="New Categories" value={newCategoryCount.toString()} />
      </div>

      {skippedCount > 0 && (
        <FireflySkippedRowsTable
          title={`${skippedCount} row${skippedCount === 1 ? '' : 's'} will not be imported`}
          rows={predictedSkippedRows}
          totalCount={skippedCount}
          headers={fireflyHeaders}
        />
      )}

      {previewRows.length === 0 ? (
        <EmptyState
          title="No preview rows"
          description="Transactions compiled from the export will appear here."
        />
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
