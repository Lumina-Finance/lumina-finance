import { ImportSkippedTable, type ImportSkippedTableRow } from '@/pages/imports/components/tables/SkippedTable'
import type { ActualSkippedRow } from '@/pages/imports/actual/types'
import { formatHundredths } from '@/pages/imports/actual/utils/normalise'

const SKIPPED_ROW_HEADERS = ['Account', 'Amount', 'Payee', 'Category', 'Notes']

/**
 * Collapsible panel listing the Actual transactions the import will not or did not write, freezing
 * the date and reason on the left while what Actual shows for each scrolls beside them
 */
export function ActualSkippedRowsTable({ title, rows, decimals }: {
  title: string
  rows: ActualSkippedRow[]

  /** Decimal places the budget's amounts are shown in */
  decimals: number
}) {
  const tableRows: ImportSkippedTableRow[] = rows.map((row) => ({
    key: row.transactionId,
    lead: row.date,
    reason: row.reason,
    cells: {
      'Account': row.accountName,
      'Amount': formatHundredths(row.amount, decimals),
      'Payee': row.payeeName ?? '',
      'Category': row.categoryName ?? '',
      'Notes': row.notes ?? '',
    },
  }))

  return (
    <ImportSkippedTable
      title={title}
      toggleLabel="skipped rows"
      leadHeader="Date"
      leadColumnWidth="6.5rem"
      leadCellClassName="font-financial tabular-nums"
      headers={SKIPPED_ROW_HEADERS}
      rows={tableRows}
      totalCount={rows.length}
    />
  )
}
