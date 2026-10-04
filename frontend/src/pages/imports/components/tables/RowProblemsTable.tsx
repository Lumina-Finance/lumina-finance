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
 * Used for both kinds of row, so the tone and reason heading default to the rows left out and the
 * list of rows that import as they are passes both. What the collapse control calls the rows is
 * always given, since every list names its own
 */
export function ImportRowProblemsTable({
  title,
  rowProblems,
  headers,
  toggleLabel,
  tone = 'danger',
  reasonHeader = 'Reason',
}: {
  title: string
  rowProblems: ImportRowProblem[]
  headers: string[]

  /** What the collapse control calls the rows, such as skipped rows */
  toggleLabel: string

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

/**
 * Lists the rows that import as they are but are worth a second look, each with its note, and
 * shows nothing while there are none
 *
 * The heading offers a look rather than stating a fault, since nothing is wrong with these rows.
 * That they are taken is left to the note against each one, which the heading cannot also carry
 * without reading like the refusal heading above it
 */
export function ImportRowWarningsTable({ rowWarnings, headers }: { rowWarnings: ImportRowProblem[]; headers: string[] }) {
  if (rowWarnings.length === 0) return null

  return (
    <div className="mb-4">
      <ImportRowProblemsTable
        title={`${rowWarnings.length} row${rowWarnings.length === 1 ? '' : 's'} worth a look`}
        rowProblems={rowWarnings}
        headers={headers}
        toggleLabel="rows worth a look"
        tone="warning"
        reasonHeader="Note"
      />
    </div>
  )
}
