import type { ReactNode } from 'react'
import {
  EmptyState,
  ImportBudgetSelectionTable,
  ImportStep,
  type ImportBudgetSelectionTableProps,
} from '@/pages/imports/components'
import { ImportSkippedTable, type ImportSkippedTableRow } from '@/pages/imports/components/tables/SkippedTable'

type ImportBudgetStepProps<Budget extends { name: string; isArchived: boolean }> = ImportBudgetSelectionTableProps<Budget> & {
  description: string

  /** The notices and explanations shown above the budgets */
  children?: ReactNode

  /** How many budgets the export holds, the skipped ones included */
  detectedCount: number

  /** The facts shown beside each skipped budget's name and reason */
  skippedHeaders: string[]
  skippedRows: ImportSkippedTableRow[]
  selectionError: string | null
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
  skippedRows,
  selectionError,
  noBudgetsDescription,
  allSkippedDescription,
  ...table
}: ImportBudgetStepProps<Budget>) {
  return (
    <ImportStep index="04" title="Budget Import" description={description}>
      {children}

      {skippedRows.length > 0 && (
        <ImportSkippedTable
          title={`${skippedRows.length} budget${skippedRows.length === 1 ? '' : 's'} skipped`}
          toggleLabel="skipped budgets"
          leadHeader="Budget"
          leadColumnWidth="10rem"
          leadCellClassName="font-medium"
          headers={skippedHeaders}
          rows={skippedRows}
          totalCount={skippedRows.length}
        />
      )}

      {selectionError && (
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
