import { EmptyState, ImportInfoCard, ImportPreviewList, ImportStat, ImportStep } from '../../components'
import { FIREFLY_SAMPLE_PREVIEW_LIMIT } from '../constants'
import type { FireflyImportWorkflow } from '../hooks'

type FireflyPreviewStepProps = Pick<
  FireflyImportWorkflow,
  | 'importEstimate'
  | 'previewRows'
  | 'previewGroups'
  | 'newAccountCount'
  | 'newCategoryCount'
  | 'importBuild'
  | 'importError'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
>

export function FireflyPreviewStep({
  importEstimate,
  previewRows,
  previewGroups,
  newAccountCount,
  newCategoryCount,
  importBuild,
  importError,
  importResult,
  canCommitImport,
  handleCommitImport,
}: FireflyPreviewStepProps) {
  return (
    <ImportStep
      index="04"
      title="Preview and Commit"
      description={`Showing the first ${FIREFLY_SAMPLE_PREVIEW_LIMIT} transactions as they will appear in your ledger.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows" value={importEstimate.rowCount.toString()} />
        <ImportStat label="Will Create" value={importEstimate.transactionEstimate.toString()} />
        <ImportStat label="New Accounts" value={newAccountCount.toString()} />
        <ImportStat label="New Categories" value={newCategoryCount.toString()} />
      </div>

      {previewRows.length === 0 ? (
        <EmptyState
          title="No preview rows"
          description="Transactions compiled from the export will appear here."
        />
      ) : (
        <ImportPreviewList groups={previewGroups} />
      )}

      <ImportInfoCard title="Skipped Rows">
        Rows the importer cannot convert are skipped and reported after the commit instead of failing the import.
        {importEstimate.skipRiskCount > 0 && (
          ` Based on the mapped accounts, ${importEstimate.skipRiskCount} row${importEstimate.skipRiskCount === 1 ? '' : 's'} may be skipped.`
        )}
        {importEstimate.invalidRowCount > 0 && (
          ` ${importEstimate.invalidRowCount} row${importEstimate.invalidRowCount === 1 ? ' is' : 's are'} missing required values and will not be uploaded.`
        )}
      </ImportInfoCard>

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
