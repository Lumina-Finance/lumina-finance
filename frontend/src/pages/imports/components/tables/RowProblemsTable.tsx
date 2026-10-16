import { SKIPPED_TABLE_VISIBLE_LIMIT } from '@/pages/imports/constants'
import type { ImportRowProblem } from '@/pages/imports/types'
import { ImportSkippedTable, type ImportSkippedTableRow } from './SkippedTable'

// Wide enough for a row number, which is all the lead cell carries while one file is staged
const ROW_NUMBER_COLUMN_WIDTH = '3.5rem'

// Wide enough for a row number above the start of a file's name, which a long name is cut to. The
// whole name is in the cell's tooltip, and the staged file list above holds it in full
const FILE_NAMED_COLUMN_WIDTH = '9rem'

/**
 * Collapsible panel listing the rows the import has something to say about, freezing which row each
 * one is on the left while every column of the uploaded file scrolls beside it, with the rows
 * grouped under what was found about them
 *
 * Used for both kinds of row, so the tone and reason heading default to the rows left out and the
 * list of rows that import as they are passes both. What the collapse control calls the rows is
 * always given, since every list names its own
 */
export function ImportRowProblemsTable({
  title,
  rowProblems,
  headers,
  amountHeaders,
  toggleLabel,
  tone = 'danger',
  reasonHeader = 'Reason',
  revealsOnReview,
  areFilesNamed = false,
}: {
  title: string
  rowProblems: ImportRowProblem[]
  headers: string[]

  /** The headers of the file's columns holding amounts */
  amountHeaders: string[]

  /** What the collapse control calls the rows, such as skipped rows */
  toggleLabel: string

  /** Whether these rows are refused or merely worth a look, which is the icon's colour */
  tone?: 'warning' | 'danger'

  /** What the note a group of rows sits under is called to a screen reader, for a list of notes rather than refusals */
  reasonHeader?: string

  /** Whether this list answers Review skipped rows on a finished import */
  revealsOnReview?: boolean

  /** Names each row's file under its number, for an import of several files, since row numbers restart in each */
  areFilesNamed?: boolean
}) {
  // Only the rows the table will show are shaped for it, and the count it summarizes the rest
  // against comes from the full list. A file whose every row is refused would otherwise rebuild a
  // table row per imported row on each render of the page
  const tableRows: ImportSkippedTableRow[] = rowProblems.slice(0, SKIPPED_TABLE_VISIBLE_LIMIT).map((problem) => ({
    key: problem.id,
    lead: areFilesNamed ? (
      <>
        <span className="block">{problem.rowNumber}</span>
        <span className="block truncate text-xs font-normal" style={{ color: 'var(--app-text-subtle)' }} title={problem.fileName}>
          {problem.fileName}
        </span>
      </>
    ) : problem.rowNumber,
    reason: problem.reason,
    cells: Object.fromEntries(headers.map((header) => [header, problem.cells[header] ?? ''])),
  }))

  return (
    <ImportSkippedTable
      title={title}
      toggleLabel={toggleLabel}
      leadHeader="Row"
      leadColumnWidth={areFilesNamed ? FILE_NAMED_COLUMN_WIDTH : ROW_NUMBER_COLUMN_WIDTH}
      leadCellClassName="font-financial font-semibold tabular-nums"
      headers={headers}
      amountHeaders={amountHeaders}
      rows={tableRows}
      totalCount={rowProblems.length}
      tone={tone}
      reasonHeader={reasonHeader}
      revealsOnReview={revealsOnReview}
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
export function ImportRowWarningsTable({ rowWarnings, headers, amountHeaders, areFilesNamed }: {
  rowWarnings: ImportRowProblem[]
  headers: string[]

  /** The headers of the file's columns holding amounts */
  amountHeaders: string[]
  areFilesNamed?: boolean
}) {
  if (rowWarnings.length === 0) return null

  return (
    <div className="mb-4">
      <ImportRowProblemsTable
        title={`${rowWarnings.length} row${rowWarnings.length === 1 ? '' : 's'} worth a look`}
        rowProblems={rowWarnings}
        headers={headers}
        amountHeaders={amountHeaders}
        toggleLabel="rows worth a look"
        tone="warning"
        reasonHeader="Note"
        areFilesNamed={areFilesNamed}
      />
    </div>
  )
}
