import type { ImportRowProblem } from '@/pages/imports/types'
import { ImportSkippedTable, type ImportSkippedTableRow } from './SkippedTable'

// Wide enough for a line number, which is all the lead cell carries because the flow stages one
// file at a time
const LINE_COLUMN_WIDTH = '3.5rem'

/**
 * Collapsible panel listing the rows the import cannot convert, freezing the line each row sits on
 * and why it was refused on the left while every column of the uploaded file scrolls beside them
 */
export function ImportRowProblemsTable({
  title,
  rowProblems,
  headers,
}: {
  title: string
  rowProblems: ImportRowProblem[]
  headers: string[]
}) {
  const tableRows: ImportSkippedTableRow[] = rowProblems.map((problem) => ({
    key: problem.id,
    lead: problem.line,
    reason: problem.reason,
    cells: Object.fromEntries(headers.map((header) => [header, problem.cells[header] ?? ''])),
  }))

  return (
    <ImportSkippedTable
      title={title}
      toggleLabel="rows to fix"
      leadHeader="Row"
      leadColumnWidth={LINE_COLUMN_WIDTH}
      leadCellClassName="font-financial font-semibold tabular-nums"
      headers={headers}
      rows={tableRows}
      totalCount={rowProblems.length}
    />
  )
}
