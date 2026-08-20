import { SKIPPED_TABLE_VISIBLE_LIMIT } from '@/pages/imports/constants'
import type { ImportRowProblem } from '@/pages/imports/types'
import { ImportSkippedTable, type ImportSkippedTableRow } from './SkippedTable'

// Wide enough for a row number, which is all the lead cell carries because the flow stages one file
// at a time
const ROW_NUMBER_COLUMN_WIDTH = '3.5rem'

/**
 * Collapsible panel listing the rows the import has something to say about, freezing which row each
 * one is and what was found on the left while every column of the uploaded file scrolls beside them
 *
 * Used for both kinds of row, so the three presentation props default to the refusal this was
 * written for and the list of rows that import as they are passes all three
 */
export function ImportRowProblemsTable({
  title,
  rowProblems,
  headers,
  toggleLabel = 'rows to fix',
  tone = 'danger',
  reasonHeader = 'Reason',
}: {
  title: string
  rowProblems: ImportRowProblem[]
  headers: string[]

  /**
   * What the collapse control calls the rows, for the tables holding rows that need no fixing.
   * Defaults to the refused rows this table was written for
   */
  toggleLabel?: string

  /** Whether these rows are refused or merely worth a look, which is the icon's colour */
  tone?: 'warning' | 'danger'

  /** What the frozen second column is headed, for a list of notes rather than refusals */
  reasonHeader?: string
}) {
  // Only the rows the table will show are shaped for it, and the count it summarizes the rest
  // against comes from the full list. A file whose every row is refused would otherwise rebuild a
  // table row per imported row on each render of the page
  const tableRows: ImportSkippedTableRow[] = rowProblems.slice(0, SKIPPED_TABLE_VISIBLE_LIMIT).map((problem) => ({
    key: problem.id,
    lead: problem.rowNumber,
    reason: problem.reason,
    cells: Object.fromEntries(headers.map((header) => [header, problem.cells[header] ?? ''])),
  }))

  return (
    <ImportSkippedTable
      title={title}
      toggleLabel={toggleLabel}
      leadHeader="Row"
      leadColumnWidth={ROW_NUMBER_COLUMN_WIDTH}
      leadCellClassName="font-financial font-semibold tabular-nums"
      headers={headers}
      rows={tableRows}
      totalCount={rowProblems.length}
      tone={tone}
      reasonHeader={reasonHeader}
    />
  )
}
