import type { ComponentProps, ReactNode } from 'react'
import { EmptyState, ImportCommitFooter, ImportPreviewList, ImportStat, ImportStep } from '@/pages/imports/components'

/**
 * Preview and commit step of a provider import, showing a sample of the transactions the commit
 * will create, the rows it leaves out and why, and the button that starts the commit
 *
 * The budget step before it only exists when the import has budgets, so the step number closes the
 * gap when there are none
 */
export function ImportProviderPreviewStep({
  hasBudgetStep,
  sampleLimit,
  stats,
  children,
  previewGroups,
  buildError,
  importError,
  imported,
  canCommit,
  onCommit,
}: {
  hasBudgetStep: boolean
  sampleLimit: number
  stats: { rowCount: number; transactionEstimate: number; newAccountCount: number; newCategoryCount: number }

  /** The rows left out and the rows worth a look, shown above the sample */
  children?: ReactNode
  previewGroups: ComponentProps<typeof ImportPreviewList>['groups']
  buildError: string | null
  importError: string | null
  imported: boolean
  canCommit: boolean
  onCommit: () => void
}) {
  return (
    <ImportStep
      index={hasBudgetStep ? '05' : '04'}
      title="Preview and Commit"
      description={`Showing the first ${sampleLimit} transactions as they will appear in your ledger.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows" value={stats.rowCount.toString()} />
        <ImportStat label="Will Create" value={stats.transactionEstimate.toString()} />
        <ImportStat label="New Accounts" value={stats.newAccountCount.toString()} />
        <ImportStat label="New Categories" value={stats.newCategoryCount.toString()} />
      </div>

      {children}

      {previewGroups.length === 0 ? (
        <EmptyState title="No preview rows" description="Transactions compiled from the export will appear here." />
      ) : (
        <ImportPreviewList groups={previewGroups} />
      )}

      <ImportCommitFooter
        buildError={buildError}
        importError={importError}
        canCommit={canCommit}
        imported={imported}
        onCommit={onCommit}
        className="pt-2"
      />
    </ImportStep>
  )
}
