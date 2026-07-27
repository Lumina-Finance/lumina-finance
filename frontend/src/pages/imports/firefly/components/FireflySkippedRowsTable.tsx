import type { FireflySkippedRowDetail } from '@/pages/imports/firefly/utils'
import { FireflySkippedTable, SkippedLeadPlaceholder, type FireflySkippedTableRow } from './FireflySkippedTable'

/**
 * Collapsible panel listing journal rows the import will not or did not
 * convert, freezing the file line number and skip reason on the left while
 * every column of the uploaded file scrolls horizontally beside them
 */
export function FireflySkippedRowsTable({
  title,
  rows,
  totalCount,
  headers,
}: {
  title: string
  rows: FireflySkippedRowDetail[]
  totalCount: number
  headers: string[]
}) {
  const tableRows: FireflySkippedTableRow[] = rows.map((row, index) => ({
    key: `${row.journalId}-${index}`,
    lead: row.rowNumber ?? <SkippedLeadPlaceholder />,
    reason: row.reason,
    cells: Object.fromEntries(headers.map((header) => [header, row.cells?.[header] ?? ''])),
  }))

  return (
    <FireflySkippedTable
      title={title}
      toggleLabel="skipped rows"
      leadHeader="Row"
      leadColumnWidth="3.5rem"
      leadCellClassName="font-financial font-semibold tabular-nums"
      headers={headers}
      rows={tableRows}
      totalCount={totalCount}
    />
  )
}
