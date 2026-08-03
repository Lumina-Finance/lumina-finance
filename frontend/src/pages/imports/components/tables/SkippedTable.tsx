import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { IMPORT_INSET_STYLE, SKIPPED_TABLE_VISIBLE_LIMIT } from '@/pages/imports/constants'

// The widest the frozen pair may grow to, measured with container units
// against the horizontal scroller. It takes less where the reasons are short
const FROZEN_GROUP_MAX_WIDTH = '30cqw'

// Floor for the reason column on a narrow panel, where its share of the width
// would leave too little to read a sentence in
const REASON_COLUMN_MIN_WIDTH = '10rem'

// Shown in place of blank values so empty cells still read as present
const EMPTY_CELL_PLACEHOLDER = '–'

// Caps the expanded table at roughly eight single-line rows plus the header,
// after which the rows scroll vertically inside the panel
const SKIPPED_TABLE_MAX_HEIGHT = '21rem'

// The frozen cells blend into the panel and stand apart through text colour
// alone, but their background must stay opaque so the raw export columns
// visibly slide beneath them
const FROZEN_COLUMN_BACKGROUND = IMPORT_INSET_STYLE.background

/**
 * Builds the frozen lead cell style, whose width doubles as the sticky
 * offset of the frozen Reason column beside it
 */
function buildFrozenLeadCellStyle(leadColumnWidth: string): CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    width: leadColumnWidth,
    minWidth: leadColumnWidth,
    maxWidth: leadColumnWidth,
    background: FROZEN_COLUMN_BACKGROUND,
    zIndex: 1,
  }
}

/**
 * Builds the frozen reason cell style, whose right border marks the edge of
 * the frozen group so scrolling columns visibly slide beneath it
 */
function buildFrozenReasonCellStyle(leadColumnWidth: string): CSSProperties {
  return {
    position: 'sticky',
    left: leadColumnWidth,
    background: FROZEN_COLUMN_BACKGROUND,
    borderRight: '1px solid var(--app-border)',
    zIndex: 1,
  }
}

// Header cells pin to the top of the vertical scroller, and the two frozen
// header cells sit above everything because they pin on both axes
const HEADER_CELL_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  background: FROZEN_COLUMN_BACKGROUND,
  borderBottom: '1px solid var(--app-border)',
  zIndex: 2,
}

const FROZEN_HEADER_Z_INDEX = 3

/**
 * Sizes the reason content, asking for the longest reason on one line and
 * stopping at the frozen pair's cap, so short reasons leave no empty column
 * beside them and long ones wrap within the cap
 *
 * The width sits on this block rather than on the cell because the table lays
 * itself out from its content, where a width or a cap on a cell is left
 * undefined and a browser may size the column to the text regardless. Without
 * a width here at all, that layout squeezes the one column that wraps down to
 * its narrowest while the nowrap file columns take the rest
 */
function buildReasonContentStyle(leadColumnWidth: string): CSSProperties {
  return {
    width: 'max-content',
    minWidth: REASON_COLUMN_MIN_WIDTH,
    maxWidth: `calc(${FROZEN_GROUP_MAX_WIDTH} - ${leadColumnWidth})`,
  }
}

// The table uses separate borders because collapsed borders do not travel
// with sticky cells, so each body cell draws its own divider
const BODY_CELL_BORDER_STYLE: CSSProperties = {
  borderTop: '1px solid var(--app-border)',
}

/**
 * One skipped item shaped for the table: the frozen lead cell, the skip
 * reason beside it, and the scrolling values keyed by column header
 */
export interface ImportSkippedTableRow {
  key: string
  lead: ReactNode
  reason: string
  cells: Record<string, string>
}

/**
 * Renders a blank raw value as a subtle dash so sparse export columns stay
 * scannable next to filled ones
 */
function RawCellValue({ value }: { value: string }) {
  if (!value) return <span style={{ color: 'var(--app-text-subtle)' }}>{EMPTY_CELL_PLACEHOLDER}</span>
  return <>{value}</>
}

/**
 * Collapsible panel listing items the import will not or did not bring in,
 * keeping only the count headline visible until expanded, then freezing the
 * lead cell and skip reason on the left while every other column scrolls
 * horizontally beside them, capped to a visible sample with the hidden
 * remainder summarized underneath
 */
export function ImportSkippedTable({
  title,
  toggleLabel,
  leadHeader,
  leadColumnWidth,
  leadCellClassName,
  headers,
  rows,
  totalCount,
}: {
  title: string

  /** Names what expands and collapses for the toggle's accessible label */
  toggleLabel: string
  leadHeader: string

  /** Fixed width of the frozen lead column, which sets the Reason offset */
  leadColumnWidth: string
  leadCellClassName: string
  headers: string[]
  rows: ImportSkippedTableRow[]
  totalCount: number
}) {
  // Expanded by default so skipped items are in view before the commit
  const [expanded, setExpanded] = useState(true)

  const visibleRows = rows.slice(0, SKIPPED_TABLE_VISIBLE_LIMIT)

  // Measured against the total the caller states rather than the rows on hand, because a caller
  // whose entries come from the backend is given a capped sample of a larger count
  const hiddenCount = totalCount - visibleRows.length

  const frozenLeadCellStyle = buildFrozenLeadCellStyle(leadColumnWidth)
  const frozenReasonCellStyle = buildFrozenReasonCellStyle(leadColumnWidth)
  const reasonContentStyle = buildReasonContentStyle(leadColumnWidth)

  return (
    <div className="rounded-lg px-4 py-3" style={IMPORT_INSET_STYLE}>
      {/* The whole headline row toggles the panel so the target is bigger
          than the chevron alone */}
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${toggleLabel}` : `Expand ${toggleLabel}`}
      >
        <span className="flex items-center gap-2">
          <TriangleAlert
            size={16}
            strokeWidth={2.25}
            className="shrink-0"
            style={{ color: 'var(--app-negative)' }}
            aria-hidden
          />
          <p className="text-sm font-semibold">{title}</p>
        </span>
        <ChevronDown
          size={17}
          className="shrink-0 transition-transform duration-150"
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
                  <th
                    className="py-1.5 pr-4 align-top font-medium"
                    style={{ ...frozenReasonCellStyle, ...HEADER_CELL_STYLE, zIndex: FROZEN_HEADER_Z_INDEX }}
                  >
                    Reason
                  </th>
                  {headers.map((header, headerIndex) => (
                    <th
                      key={header}
                      className={`whitespace-nowrap py-1.5 pr-4 align-top font-medium ${headerIndex === 0 ? 'pl-4' : ''}`}
                      style={HEADER_CELL_STYLE}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key}>
                    <td
                      className={`py-1.5 pr-3 align-top ${leadCellClassName}`}
                      style={{ ...frozenLeadCellStyle, ...BODY_CELL_BORDER_STYLE, color: 'var(--app-accent)' }}
                    >
                      <div className="truncate">{row.lead}</div>
                    </td>
                    <td
                      className="py-1.5 pr-4 align-top"
                      style={{ ...frozenReasonCellStyle, ...BODY_CELL_BORDER_STYLE, color: 'var(--app-accent)' }}
                    >
                      <div className="whitespace-normal break-words" style={reasonContentStyle}>
                        {row.reason}
                      </div>
                    </td>
                    {headers.map((header, headerIndex) => (
                      <td
                        key={header}
                        className={`whitespace-nowrap py-1.5 pr-4 align-top ${headerIndex === 0 ? 'pl-4' : ''}`}
                        style={BODY_CELL_BORDER_STYLE}
                      >
                        <RawCellValue value={row.cells[header] ?? ''} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
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

/**
 * Shared placeholder for a lead cell with nothing to show
 */
export function SkippedLeadPlaceholder() {
  return <span style={{ color: 'var(--app-text-subtle)' }}>{EMPTY_CELL_PLACEHOLDER}</span>
}
