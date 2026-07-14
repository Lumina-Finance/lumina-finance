import { ImportStat, ImportStep } from '../../components'
import { FireflySkippedRowsTable } from '../components'
import type { FireflyImportWorkflow } from '../hooks'

type FireflyResultsStepProps = Pick<FireflyImportWorkflow, 'importResult' | 'resultSkippedRows' | 'fireflyHeaders'>

export function FireflyResultsStep({ importResult, resultSkippedRows, fireflyHeaders }: FireflyResultsStepProps) {
  if (!importResult) return null

  return (
    <ImportStep
      index="05"
      title="Import Results"
      description="Summary of the committed transaction import."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows Imported" value={importResult.rows_imported.toString()} />
        <ImportStat label="Rows Skipped" value={importResult.rows_skipped.toString()} />
        <ImportStat label="Transactions" value={importResult.transactions_created.toString()} />
        <ImportStat label="Accounts Created" value={importResult.accounts_created.toString()} />
        <ImportStat label="Categories Created" value={importResult.categories_created.toString()} />
        <ImportStat label="Merchants Created" value={importResult.merchants_created.toString()} />
        <ImportStat label="Tags Created" value={importResult.tags_created.toString()} />
      </div>

      {resultSkippedRows.length > 0 && (
        <FireflySkippedRowsTable
          title={`${importResult.rows_skipped} row${importResult.rows_skipped === 1 ? '' : 's'} skipped`}
          rows={resultSkippedRows}
          totalCount={importResult.rows_skipped}
          headers={fireflyHeaders}
        />
      )}
    </ImportStep>
  )
}
