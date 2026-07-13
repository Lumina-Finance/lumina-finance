import { ImportStat, ImportStep } from '../../components'
import { IMPORT_INSET_STYLE } from '../../constants'
import { FIREFLY_SKIPPED_VISIBLE_LIMIT } from '../constants'
import type { FireflyImportWorkflow } from '../hooks'

type FireflyResultsStepProps = Pick<FireflyImportWorkflow, 'importResult'>

export function FireflyResultsStep({ importResult }: FireflyResultsStepProps) {
  if (!importResult) return null

  const visibleSkipped = importResult.skipped.slice(0, FIREFLY_SKIPPED_VISIBLE_LIMIT)
  const hiddenSkippedCount = importResult.skipped.length - visibleSkipped.length

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

      {importResult.skipped.length > 0 && (
        <div className="rounded-lg px-4 py-3" style={IMPORT_INSET_STYLE}>
          <p className="text-sm font-semibold">Skipped rows</p>
          <ul className="mt-2 space-y-1">
            {visibleSkipped.map((row) => (
              <li key={row.journal_id} className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                <span className="font-financial tabular-nums">#{row.journal_id}</span>
                {` · ${row.reason}`}
              </li>
            ))}
          </ul>
          {hiddenSkippedCount > 0 && (
            <p className="mt-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              {`and ${hiddenSkippedCount} more`}
            </p>
          )}
        </div>
      )}
    </ImportStep>
  )
}
