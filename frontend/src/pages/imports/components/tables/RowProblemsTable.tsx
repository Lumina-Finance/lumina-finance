import type { ImportRowProblem } from '@/pages/imports/types'
import { ImportSkippedTable, type ImportSkippedTableRow } from './SkippedTable'

// Wide enough for a file name beside a line number, which the lead cell only carries when more
// than one file is staged
const FILE_AND_LINE_COLUMN_WIDTH = '11rem'
const LINE_COLUMN_WIDTH = '3.5rem'

/**
 * Collapsible panel listing the rows the import cannot convert, freezing where each row came from
 * and why it was refused on the left while every column of the uploaded file scrolls beside them
 *
 * The lead cell carries the file name only where several files are staged, since repeating one
 * file name down every row would spend the frozen column on nothing
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
  const hasSeveralFiles = new Set(rowProblems.map((problem) => problem.fileName)).size > 1

  const tableRows: ImportSkippedTableRow[] = rowProblems.map((problem) => ({
    key: problem.id,
    lead: hasSeveralFiles ? `${problem.fileName} · ${problem.line}` : problem.line,
    reason: problem.reason,
    cells: Object.fromEntries(headers.map((header) => [header, problem.cells[header] ?? ''])),
  }))

  return (
    <ImportSkippedTable
      title={title}
      toggleLabel="rows to fix"
      leadHeader={hasSeveralFiles ? 'File and row' : 'Row'}
      leadColumnWidth={hasSeveralFiles ? FILE_AND_LINE_COLUMN_WIDTH : LINE_COLUMN_WIDTH}
      leadCellClassName="font-financial font-semibold tabular-nums"
      headers={headers}
      rows={tableRows}
      totalCount={rowProblems.length}
    />
  )
}
