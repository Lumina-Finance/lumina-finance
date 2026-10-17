import {
  FILE_NAMED_LEAD_COLUMN_WIDTH,
  ImportSkippedTable,
  SkippedFileNamedLead,
  type ImportSkippedTableRow,
} from '@/pages/imports/components/tables/SkippedTable'
import type { OfxSkippedRow } from '@/pages/imports/ofx/types'

const SKIPPED_ROW_HEADERS = ['Account', 'Amount', 'Merchant', 'Notes']
const SKIPPED_ROW_AMOUNT_HEADERS = ['Amount']

/**
 * Collapsible panel listing the transactions the import will not or did not write, freezing the
 * posted date on the left while what the file states for each scrolls beside it, with the reason
 * under each row
 *
 * @param areFilesNamed - Names each row's file under its date, for an import of several files
 */
export function OfxSkippedRowsTable({ title, rows, areFilesNamed }: { title: string; rows: OfxSkippedRow[]; areFilesNamed: boolean }) {
  const tableRows: ImportSkippedTableRow[] = rows.map((row) => ({
    key: row.id,
    lead: areFilesNamed ? <SkippedFileNamedLead lead={row.postedLabel} fileName={row.fileName} /> : row.postedLabel,
    reason: row.reason,
    cells: {
      'Account': row.statementLabel,
      'Amount': row.amountText,
      'Merchant': row.payee ?? '',
      'Notes': row.memo ?? '',
    },
  }))

  return (
    <ImportSkippedTable
      title={title}
      toggleLabel="skipped rows"
      leadHeader="Posted"
      leadColumnWidth={FILE_NAMED_LEAD_COLUMN_WIDTH}
      leadCellClassName="font-financial tabular-nums"
      headers={SKIPPED_ROW_HEADERS}
      amountHeaders={SKIPPED_ROW_AMOUNT_HEADERS}
      rows={tableRows}
      totalCount={rows.length}
      revealsOnReview
    />
  )
}
