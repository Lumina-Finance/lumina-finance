import { useState, type CSSProperties } from 'react'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { IMPORT_INSET_STYLE } from '../../constants'
import { FIREFLY_SKIPPED_TABLE_VISIBLE_LIMIT } from '../constants'
import type { FireflySkippedRowDetail } from '../utils'

// Width of the frozen Row column, which doubles as the sticky offset of the
// frozen Reason column beside it
const ROW_COLUMN_WIDTH = '3.5rem'

// Share of the visible panel the frozen pair holds, measured with container
// units against the horizontal scroller
const FROZEN_GROUP_WIDTH = '30cqw'

// Shown in place of blank values so empty cells still read as present
const EMPTY_CELL_PLACEHOLDER = '–'

// Caps the expanded table at roughly eight single-line rows plus the header,
// after which the rows scroll vertically inside the panel
const SKIPPED_TABLE_MAX_HEIGHT = '21rem'

// The frozen cells blend into the panel and stand apart through text colour
// alone, but their background must stay opaque so the raw export columns
// visibly slide beneath them
const FROZEN_COLUMN_BACKGROUND = IMPORT_INSET_STYLE.background

const FROZEN_ROW_CELL_STYLE: CSSProperties = {
  position: 'sticky',
  left: 0,
  width: ROW_COLUMN_WIDTH,
  minWidth: ROW_COLUMN_WIDTH,
  background: FROZEN_COLUMN_BACKGROUND,
  zIndex: 1,
}

// The right border marks the edge of the frozen group so scrolling columns
// visibly slide beneath it
const FROZEN_REASON_CELL_STYLE: CSSProperties = {
  position: 'sticky',
  left: ROW_COLUMN_WIDTH,
  background: FROZEN_COLUMN_BACKGROUND,
  borderRight: '1px solid var(--app-border)',
  zIndex: 1,
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

// Sizes the reason content so the frozen pair holds its share of the panel
// exactly, since table auto-layout would otherwise squeeze the wrapping
// column to its minimum while the nowrap raw columns take the rest
const REASON_CONTENT_STYLE: CSSProperties = {
  width: `calc(${FROZEN_GROUP_WIDTH} - ${ROW_COLUMN_WIDTH})`,
  minWidth: '10rem',
}

// The table uses separate borders because collapsed borders do not travel
// with sticky cells, so each body cell draws its own divider
const BODY_CELL_BORDER_STYLE: CSSProperties = {
  borderTop: '1px solid var(--app-border)',
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
 * Collapsible panel listing journal rows the import will not or did not
 * convert, keeping only the count headline visible until expanded, then
 * freezing the file line number and skip reason on the left while every
 * column of the uploaded file scrolls horizontally beside them, capped to a
 * visible sample with the hidden remainder summarized underneath
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
  // Expanded by default so unconvertible rows are in view before the commit
  const [expanded, setExpanded] = useState(true)

  const visibleRows = rows.slice(0, FIREFLY_SKIPPED_TABLE_VISIBLE_LIMIT)

  // The backend caps the detailed entries it returns, so the remainder is
  // measured against the exact total rather than the rows on hand
  const hiddenCount = totalCount - visibleRows.length

  return (
    <div className="rounded-lg px-4 py-3" style={IMPORT_INSET_STYLE}>
      {/* The whole headline row toggles the panel so the target is bigger
          than the chevron alone */}
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse skipped rows' : 'Expand skipped rows'}
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
                    style={{ ...FROZEN_ROW_CELL_STYLE, ...HEADER_CELL_STYLE, zIndex: FROZEN_HEADER_Z_INDEX }}
                  >
                    Row
                  </th>
                  <th
                    className="py-1.5 pr-4 align-top font-medium"
                    style={{ ...FROZEN_REASON_CELL_STYLE, ...HEADER_CELL_STYLE, zIndex: FROZEN_HEADER_Z_INDEX }}
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
                {visibleRows.map((row, index) => (
                  <tr key={`${row.journalId}-${index}`}>
                    <td
                      className="whitespace-nowrap py-1.5 pr-3 align-top font-financial font-semibold tabular-nums"
                      style={{ ...FROZEN_ROW_CELL_STYLE, ...BODY_CELL_BORDER_STYLE, color: 'var(--app-accent)' }}
                    >
                      {row.rowNumber ?? <span style={{ color: 'var(--app-text-subtle)' }}>{EMPTY_CELL_PLACEHOLDER}</span>}
                    </td>
                    <td
                      className="py-1.5 pr-4 align-top"
                      style={{ ...FROZEN_REASON_CELL_STYLE, ...BODY_CELL_BORDER_STYLE, color: 'var(--app-accent)' }}
                    >
                      <div className="whitespace-normal break-words" style={REASON_CONTENT_STYLE}>
                        {row.reason}
                      </div>
                    </td>
                    {headers.map((header, headerIndex) => (
                      <td
                        key={header}
                        className={`whitespace-nowrap py-1.5 pr-4 align-top ${headerIndex === 0 ? 'pl-4' : ''}`}
                        style={BODY_CELL_BORDER_STYLE}
                      >
                        <RawCellValue value={row.cells?.[header] ?? ''} />
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
