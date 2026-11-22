import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { BudgetCountCheck } from '@/pages/imports/utils/providerImportRun'
import {
  EmptyState,
  ImportBudgetSelectionTable,
  ImportStep,
  type ImportBudgetSelectionTableProps,
} from '@/pages/imports/components'
import { ImportSkippedTable, type ImportSkippedTableRow } from '@/pages/imports/components/tables/SkippedTable'

type ImportBudgetStepProps<Budget extends { name: string; isArchived: boolean }> =
  ImportBudgetSelectionTableProps<Budget> & {
    description: string

    /** The notices and explanations shown above the budgets */
    children?: ReactNode

    /** How many budgets the export holds, the skipped ones included */
    detectedCount: number

    /** The facts shown beside each skipped budget's name and reason */
    skippedHeaders: string[]

    /** The facts among them that are amounts */
    skippedAmountHeaders: string[]
    skippedRows: ImportSkippedTableRow[]

    /** The language the skipped budgets' reasons are written in when it differs from the page's */
    skippedReasonLang?: string
    selectionError: string | null

    /** Set while the selection waits on the count of the person's budgets. The wait shows apart from an error */
    selectionCheck: BudgetCountCheck
    onRetrySelectionCheck: () => void

    /** The count of budgets is being asked for again after a failure */
    isRetryingSelectionCheck: boolean
    noBudgetsDescription: string
    allSkippedDescription: string
  }

/**
 * Previews the budgets a provider import will create and lets the user choose them
 *
 * Budgets the import can't create move into their own skipped panel with the reason. The import
 * creates the selected budgets in the same save as the transactions, so this step has no import
 * button of its own
 */
export function ImportBudgetStep<Budget extends { name: string; isArchived: boolean }>({
  description,
  children,
  detectedCount,
  skippedHeaders,
  skippedAmountHeaders,
  skippedRows,
  skippedReasonLang,
  selectionError,
  selectionCheck,
  onRetrySelectionCheck,
  isRetryingSelectionCheck,
  noBudgetsDescription,
  allSkippedDescription,
  ...table
}: ImportBudgetStepProps<Budget>) {
  return (
    <ImportStep index="05" title="Budget import" description={description}>
      {children}

      {skippedRows.length > 0 && (
        <ImportSkippedTable
          title={`${skippedRows.length} budget${skippedRows.length === 1 ? '' : 's'} skipped`}
          toggleLabel="skipped budgets"
          leadHeader="Budget"
          leadColumnWidth="10rem"
          leadCellClassName="font-medium"
          headers={skippedHeaders}
          amountHeaders={skippedAmountHeaders}
          rows={skippedRows}
          totalCount={skippedRows.length}
          reasonLang={skippedReasonLang}
        />
      )}

      {selectionError && selectionCheck === 'failed' && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg py-1 pl-3 pr-1.5 text-xs"
          style={{ background: 'var(--app-negative-soft)', color: 'var(--app-text)' }}
        >
          <TriangleAlert size={14} aria-hidden className="shrink-0" style={{ color: 'var(--app-negative)' }} />
          <span className="min-w-0 flex-1 text-pretty">{selectionError}</span>
          <button
            type="button"
            onClick={() => {
              if (!isRetryingSelectionCheck) onRetrySelectionCheck()
            }}
            aria-disabled={isRetryingSelectionCheck}
            aria-busy={isRetryingSelectionCheck}
            className="app-inline-link shrink-0 font-medium underline underline-offset-2 aria-disabled:cursor-default"
          >
            {isRetryingSelectionCheck ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}
      {selectionError && selectionCheck === 'checking' && (
        <p role="status" className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
          {selectionError}
        </p>
      )}
      {selectionError && selectionCheck === null && (
        <p role="alert" className="text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {selectionError}
        </p>
      )}

      {detectedCount === 0 ? (
        <EmptyState title="No budgets detected" description={noBudgetsDescription} />
      ) : table.budgets.length === 0 ? (
        <EmptyState title="No importable budgets" description={allSkippedDescription} />
      ) : (
        <ImportBudgetSelectionTable {...table} />
      )}
    </ImportStep>
  )
}
