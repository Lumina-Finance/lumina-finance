import { EmptyState, ImportInfoCard, ImportStat, ImportStep } from '../../components'
import { FIREFLY_SAMPLE_PREVIEW_LIMIT } from '../constants'
import type { FireflyImportWorkflow } from '../hooks'

type FireflyPreviewStepProps = Pick<
  FireflyImportWorkflow,
  | 'importEstimate'
  | 'sampleRows'
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
  sampleRows,
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
      description={`Showing the first ${FIREFLY_SAMPLE_PREVIEW_LIMIT} rows from the export.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows" value={importEstimate.rowCount.toString()} />
        <ImportStat label="Will Create" value={importEstimate.transactionEstimate.toString()} />
        <ImportStat label="New Accounts" value={newAccountCount.toString()} />
        <ImportStat label="New Categories" value={newCategoryCount.toString()} />
      </div>

      <ImportInfoCard title="Skipped Rows">
        Rows the importer cannot convert are skipped and reported after the commit instead of failing the import.
        {importEstimate.skipRiskCount > 0 && (
          ` Based on the mapped accounts, ${importEstimate.skipRiskCount} row${importEstimate.skipRiskCount === 1 ? '' : 's'} may be skipped.`
        )}
        {importEstimate.invalidRowCount > 0 && (
          ` ${importEstimate.invalidRowCount} row${importEstimate.invalidRowCount === 1 ? ' is' : 's are'} missing required values and will not be uploaded.`
        )}
      </ImportInfoCard>

      {sampleRows.length === 0 ? (
        <EmptyState
          title="No preview rows"
          description="Rows from the transactions CSV will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] table-fixed text-left text-[0.9375rem]">
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[26%]" />
              <col className="w-[26%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">From / To</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((row) => (
                <tr key={row.journalId}>
                  <td className="px-4 py-2.5 align-middle font-financial tabular-nums">{row.dt}</td>
                  <td className="px-4 py-2.5 align-middle">{row.type}</td>
                  <td className="truncate px-4 py-2.5 align-middle">{row.description}</td>
                  <td className="truncate px-4 py-2.5 align-middle" style={{ color: 'var(--app-text-muted)' }}>
                    {row.endpoints}
                  </td>
                  <td className="px-4 py-2.5 text-right align-middle font-financial tabular-nums">
                    {`${row.amount} ${row.currencyCode}`}
                  </td>
                  <td className="truncate px-4 py-2.5 align-middle">{row.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
