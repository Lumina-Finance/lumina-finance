import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { SkippedRowsReviewContext } from '@/contexts/SkippedRowsReviewContext'
import { IMPORT_INSET_STYLE, SKIPPED_TABLE_VISIBLE_LIMIT } from '@/pages/imports/constants'
import { clipSkippedCellValue } from '@/pages/imports/utils/valueParsers'

// Shown in place of blank values so empty cells still read as present
const EMPTY_CELL_PLACEHOLDER = '–'

// Caps the height of the expanded table, after which the rows scroll vertically inside the panel
const SKIPPED_TABLE_MAX_HEIGHT = '21rem'

// The frozen cells blend into the panel and stand apart through text colour
// alone, but their background must stay opaque so the raw export columns
// visibly slide beneath them
const FROZEN_COLUMN_BACKGROUND = IMPORT_INSET_STYLE.background

// The three layers inside this table's own scroller, in order. They order the table's cells against
// each other and reach nothing outside it, so they are not levels on the app's stacking scale
const FROZEN_COLUMN_Z_INDEX = 1
const HEADER_ROW_Z_INDEX = 2
const FROZEN_HEADER_Z_INDEX = 3

/**
 * Builds the frozen lead cell style, whose right border marks the frozen edge
 * so scrolling columns visibly slide beneath it
 */
function buildFrozenLeadCellStyle(leadColumnWidth: string): CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    width: leadColumnWidth,
    minWidth: leadColumnWidth,
    maxWidth: leadColumnWidth,
    background: FROZEN_COLUMN_BACKGROUND,
    borderRight: '1px solid var(--app-border)',
    zIndex: FROZEN_COLUMN_Z_INDEX,
  }
}

// A group's reason spans the table above its rows and holds still at the scroller's width, so it
// reads at full width wherever the columns beneath it are scrolled to
const REASON_LINE_STYLE: CSSProperties = {
  position: 'sticky',
  left: 0,
  width: '100cqw',
}

// The room above every group's reason after the first, so the groups read as separate blocks and
// the hairlines between a group's own rows stay the quieter division
const GROUP_GAP_CLASS_NAME = 'pt-5'

// Header cells pin to the top of the vertical scroller, and the two frozen
// header cells sit above everything because they pin on both axes
const HEADER_CELL_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  background: FROZEN_COLUMN_BACKGROUND,
  borderBottom: '1px solid var(--app-border)',
  zIndex: HEADER_ROW_Z_INDEX,
}

// The table uses separate borders because collapsed borders do not travel
// with sticky cells, so each body cell draws its own divider
const BODY_CELL_BORDER_STYLE: CSSProperties = {
  borderTop: '1px solid var(--app-border)',
}

// An amount column lines up on the right with its header, and its values show in tabular figures as
// the preview's amounts do while keeping the text the file wrote. The header keeps the interface
// type, as the budget table's headers do
const AMOUNT_VALUE_CLASS_NAME = 'font-financial tabular-nums'

/**
 * One skipped item shaped for the table: the frozen lead cell, the scrolling
 * values keyed by column header, and the reason it is grouped under with the rows sharing it
 */
export interface ImportSkippedTableRow {
  key: string
  lead: ReactNode
  reason: string
  cells: Record<string, string>
}

/**
 * Splits rows into groups sharing one reason word for word, in the order each reason first appears,
 * with the rows of a group in the order they were given
 */
function groupRowsByReason(rows: ImportSkippedTableRow[]) {
  const groups = new Map<string, ImportSkippedTableRow[]>()
  for (const row of rows) {
    const group = groups.get(row.reason)
    if (group) group.push(row)
    else groups.set(row.reason, [row])
  }
  return [...groups].map(([reason, groupRows]) => ({ reason, rows: groupRows }))
}

/**
 * Renders a blank raw value as a subtle dash so sparse export columns stay
 * scannable next to filled ones
 */
function RawCellValue({ value }: { value: string }) {
  if (!value) return <span style={{ color: 'var(--app-text-subtle)' }}>{EMPTY_CELL_PLACEHOLDER}</span>
  return <>{clipSkippedCellValue(value)}</>
}

/**
 * Collapsible panel listing rows the import has something to say about, keeping
 * only the count headline visible until expanded, then freezing the lead cell
 * on the left while every other column scrolls horizontally beside it, with
 * the rows grouped under the note they share, capped to a visible sample
 * with the hidden remainder summarized underneath
 *
 * Each note is said once on a line of its own above its group rather than in a
 * column or under every row, so a long one reads in a few lines without making
 * a row tall or taking the room the file's columns need, which a phone has
 * little of. A group is a body of its own headed by its note as a row group
 * header, so a screen reader reads each row with the note it falls under
 */
export function ImportSkippedTable({
  title,
  toggleLabel,
  leadHeader,
  leadColumnWidth,
  leadCellClassName,
  headers,
  amountHeaders,
  rows,
  totalCount,
  tone = 'danger',
  reasonHeader = 'Reason',
  reasonLang,
  revealsOnReview = false,
}: {
  title: string

  /** What the expand and collapse control calls the rows in its accessible label */
  toggleLabel: string
  leadHeader: string

  /** Fixed width of the frozen lead column */
  leadColumnWidth: string
  leadCellClassName: string
  headers: string[]

  /** The headers whose columns hold amounts, given even when none do so no caller forgets them */
  amountHeaders: string[]
  rows: ImportSkippedTableRow[]
  totalCount: number

  /**
   * Whether the rows are refused or merely worth a look, which is the icon's colour. Defaults to
   * the refusal this table was written for, so a caller listing rows the import will not take says
   * nothing. Takes the same two words `ImportNotice` uses
   */
  tone?: 'warning' | 'danger'

  /**
   * What the note a group of rows sits under is called to a screen reader. Reason is the right word for a
   * refusal and the wrong one for a note against rows that import as they stand
   */
  reasonHeader?: string

  /** The language the reasons are written in when it differs from the page's, such as a backend refusal kept in English */
  reasonLang?: string

  /**
   * Whether this list answers Review skipped rows on a finished import, by opening, scrolling to its
   * top and taking focus. Only the list of rows the import left out does
   */
  revealsOnReview?: boolean
}) {
  // Expanded by default so skipped items are in view before the commit
  const [expanded, setExpanded] = useState(true)

  // Each request to review is answered once. The count seen at mount was answered before this list
  // existed, so only a later one opens it
  const reviewCount = useContext(SkippedRowsReviewContext)
  const [answeredReviewCount, setAnsweredReviewCount] = useState(reviewCount)
  const mountReviewCount = useRef(reviewCount)
  if (revealsOnReview && reviewCount !== answeredReviewCount) {
    setAnsweredReviewCount(reviewCount)
    setExpanded(true)
  }
  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const shouldReduceMotion = useReducedMotion()
  useEffect(() => {
    if (answeredReviewCount === mountReviewCount.current) return
    // Waits a frame so the rows just opened count towards where the scroll lands
    const frame = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: shouldReduceMotion ? 'auto' : 'smooth', block: 'start' })
      toggleRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [answeredReviewCount, shouldReduceMotion])

  const visibleRows = rows.slice(0, SKIPPED_TABLE_VISIBLE_LIMIT)
  const reasonGroups = groupRowsByReason(visibleRows)
  const reasonColor = tone === 'danger' ? 'var(--app-negative)' : 'var(--app-warning-text)'

  // Measured against the total the caller states rather than the rows it passed, so a caller
  // holding more entries than it shapes for the table still summarizes all of them
  const hiddenCount = totalCount - visibleRows.length

  const frozenLeadCellStyle = buildFrozenLeadCellStyle(leadColumnWidth)
  const getColumnClassName = (header: string, headerIndex: number, cell: 'header' | 'value') => {
    const isAmount = amountHeaders.includes(header)
    return [
      'whitespace-nowrap py-1.5 pr-4 align-top',
      headerIndex === 0 ? 'pl-4' : '',
      isAmount ? 'text-right' : '',
      cell === 'header' ? 'font-medium' : '',
      isAmount && cell === 'value' ? AMOUNT_VALUE_CLASS_NAME : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div ref={panelRef} className="scroll-mt-4 rounded-lg px-4 py-3" style={IMPORT_INSET_STYLE}>
      {/* The whole headline row toggles the panel so the target is bigger
          than the chevron alone */}
      <button
        type="button"
        ref={toggleRef}
        className="-mx-2 -my-1.5 flex w-[calc(100%+1rem)] cursor-pointer items-center justify-between gap-3 px-2 py-1.5 app-accent-hover rounded-md text-left transition-control motion-reduce:transition-none"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${toggleLabel}` : `Expand ${toggleLabel}`}
      >
        <span className="flex items-center gap-2">
          <TriangleAlert
            size={16}
            strokeWidth={2.25}
            className="shrink-0"
            style={{ color: tone === 'danger' ? 'var(--app-negative)' : 'var(--app-warning-text)' }}
            aria-hidden
          />
          <p className="text-sm font-semibold">{title}</p>
        </span>
        <ChevronDown
          size={17}
          className="shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--app-text-muted)' }}
          aria-hidden
        />
      </button>
      {expanded && (
        <>
          <div
            className="mt-2 overflow-auto"
            style={{ containerType: 'inline-size', maxHeight: SKIPPED_TABLE_MAX_HEIGHT }}
          >
            <table className="w-full border-separate border-spacing-0 text-left text-[0.9375rem]">
              <thead>
                <tr style={{ color: 'var(--app-text-subtle)' }}>
                  <th
                    className="py-1.5 pr-3 align-top font-medium"
                    style={{ ...frozenLeadCellStyle, ...HEADER_CELL_STYLE, zIndex: FROZEN_HEADER_Z_INDEX }}
                  >
                    {leadHeader}
                  </th>
                  {headers.map((header, headerIndex) => (
                    <th
                      key={header}
                      className={getColumnClassName(header, headerIndex, 'header')}
                      style={HEADER_CELL_STYLE}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              {reasonGroups.map((group, groupIndex) => (
                <tbody key={group.reason}>
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={headers.length + 1}
                      className={`pb-1.5 text-left font-medium ${groupIndex > 0 ? GROUP_GAP_CLASS_NAME : ''}`}
                    >
                      <div
                        className="box-border whitespace-normal break-words pr-4 text-pretty"
                        style={{ ...REASON_LINE_STYLE, color: reasonColor }}
                      >
                        <span className="sr-only">{`${reasonHeader}: `}</span>
                        <span lang={reasonLang}>{group.reason}</span>
                      </div>
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.key}>
                      <td
                        className={`py-1.5 pr-3 align-top ${leadCellClassName}`}
                        style={{ ...frozenLeadCellStyle, ...BODY_CELL_BORDER_STYLE, color: 'var(--app-accent)' }}
                      >
                        <div className="truncate">{row.lead}</div>
                      </td>
                      {headers.map((header, headerIndex) => (
                        <td
                          key={header}
                          className={getColumnClassName(header, headerIndex, 'value')}
                          style={BODY_CELL_BORDER_STYLE}
                        >
                          <RawCellValue value={row.cells[header] ?? ''} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          {hiddenCount > 0 && (
            <p className="mt-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              {`and ${hiddenCount} more`}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// Wide enough for a date, which wraps onto a second line when the whole of it does not fit, above
// the start of a file's name, which a long name is cut to. The whole name is in the cell's tooltip,
// and the staged file list holds it in full
export const FILE_NAMED_LEAD_COLUMN_WIDTH = '9rem'

/**
 * A lead cell that names the file its row is from under what the row is led by, for an import of
 * several files, since row numbers restart in each file and a date is no help in finding which
 */
export function SkippedFileNamedLead({ lead, fileName }: { lead: ReactNode; fileName: string | undefined }) {
  // A name shared by several files ends in its position, such as " (file 2)", which is all that
  // tells those files apart, so the name is cut before it and the position is left whole
  const position = fileName === undefined ? null : SHARED_NAME_POSITION_PATTERN.exec(fileName)
  const baseName = position && fileName !== undefined ? fileName.slice(0, position.index) : fileName

  return (
    <>
      {/* Wraps where the cell cuts its own content, so a date wider than the column shows whole */}
      <span className="block whitespace-normal">{lead}</span>
      <span className="flex text-xs font-normal" style={{ color: 'var(--app-text-subtle)' }} title={fileName}>
        <span className="truncate">{baseName}</span>
        {position && <span className="shrink-0 whitespace-pre">{position[0]}</span>}
      </span>
    </>
  )
}

// The position combining files adds to a name that more than one of them has
const SHARED_NAME_POSITION_PATTERN = / \(file \d+\)$/

/**
 * Shared placeholder for a lead cell with nothing to show
 */
export function SkippedLeadPlaceholder() {
  return <span style={{ color: 'var(--app-text-subtle)' }}>{EMPTY_CELL_PLACEHOLDER}</span>
}
