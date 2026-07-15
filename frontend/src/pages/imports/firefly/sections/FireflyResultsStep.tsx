import { ImportStat, ImportStep } from '../../components'
import { FireflySkippedRowsTable } from '../components'
import type { FireflyImportWorkflow } from '../hooks'

type FireflyResultsStepProps = Pick<
  FireflyImportWorkflow,
  'importResult' | 'resultSkippedRows' | 'resultSkippedCount' | 'fireflyHeaders' | 'budgetsFile'
>

export function FireflyResultsStep({
  importResult,
  resultSkippedRows,
  resultSkippedCount,
  fireflyHeaders,
  budgetsFile,
}: FireflyResultsStepProps) {
  if (!importResult) return null

  return (
    <ImportStep
      // The budget step only exists when a budgets export is staged, so the
      // steps after it close the gap when there is none
      index={budgetsFile ? '06' : '05'}
      title="Import Results"
      description="Summary of the committed transaction import."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows Imported" value={importResult.rows_imported.toString()} />
        <ImportStat label="Rows Skipped" value={resultSkippedCount.toString()} />
        <ImportStat label="Transactions" value={importResult.transactions_created.toString()} />
        <ImportStat label="Accounts Created" value={importResult.accounts_created.toString()} />
        <ImportStat label="Categories Created" value={importResult.categories_created.toString()} />
        <ImportStat label="Merchants Created" value={importResult.merchants_created.toString()} />
        <ImportStat label="Tags Created" value={importResult.tags_created.toString()} />
      </div>

      {resultSkippedRows.length > 0 && (
        <FireflySkippedRowsTable
          title={`${resultSkippedCount} row${resultSkippedCount === 1 ? '' : 's'} skipped`}
          rows={resultSkippedRows}
          totalCount={resultSkippedCount}
          headers={fireflyHeaders}
        />
      )}
    </ImportStep>
  )
}
