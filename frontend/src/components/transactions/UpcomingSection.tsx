import { useRef, type CSSProperties, type ReactNode } from 'react'
import { CalendarClock } from 'lucide-react'
import { CollapsibleSection, CollapsibleSectionCount } from '@/components/collapsible-section/Section'
import { FadedRowsContext } from '@/contexts/FadedRowsContext'
import {
  REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
  TRANSACTION_CHECKBOX_RAIL,
} from '@/pages/transactions/constants/transactionList'
import { formatShortDateRangeLabel } from '@/utils/date'

export const UPCOMING_EXPLANATION =
  "These haven't happened yet, so they won't count toward your balances, budgets or totals until their date."

// Fades the upcoming rows by drawing their main text in the muted colour, which sets them apart from the
// rows that count while keeping every line readable. Lowering their opacity instead took the muted and
// subtle text below the contrast every text needs. A read-only row inside skips its own opacity fade for
// the same reason, and still says why beside its account. The text colour is set as well as the token,
// since text that inherits its colour took it from the page before the token changed
const UPCOMING_ROW_COLOURS = { '--app-text': 'var(--app-text-muted)', color: 'var(--app-text)' } as CSSProperties

// A day's total inside sits on its heading's bar, where the muted colour falls short of the contrast text needs
// in the dark theme, so it is drawn a quarter of the way toward the full text colour. It is mixed on the
// section rather than beside the rows' colours, which have already swapped the full colour for the muted one
const DAY_TOTAL_MIX = {
  '--upcoming-day-total': 'color-mix(in srgb, var(--app-text-muted) 75%, var(--app-text))',
} as CSSProperties
export const UPCOMING_DAY_TOTAL_COLOUR = 'var(--upcoming-day-total)'

// Runs the header across the checkbox rail like a day heading, indented as a day heading is outside
// selection. It holds nothing to tick, so its icon stays put when the rail opens and sits over the ticks
// rather than leaving an empty slot beside it
const HEADER_ACROSS_THE_LIST: CSSProperties = {
  ...REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
  paddingInline: '0.75rem',
}

// Draws the section as a shaded box with a dashed edge, set apart from the rows that count. Both are layers
// over the section rather than a border and padding on it, since the section shares the list's columns and
// padding would push its cells off them. They reach across the checkbox rail as the rows do and end where the
// rows end, so the box lines up with the search bar and the day headings around it. The shading sits behind the
// rows and the edge in front of them, since the day headings' bars and the stuck header run the full width and
// would otherwise cover its sides. The edge takes the subtle text colour, since the border colours were too
// faint to show its dashes
const BOX_EDGE_LINE = '1.5px dashed color-mix(in srgb, var(--app-text-subtle) 60%, transparent)'
const BOX_AROUND_THE_SECTION: CSSProperties = {
  left: `calc(-1 * ${TRANSACTION_CHECKBOX_RAIL})`,
  right: 0,
}
const BOX_SHADING: CSSProperties = { ...BOX_AROUND_THE_SECTION, background: 'var(--app-surface-soft)' }

// The top of the box is a strip of its own, the room above the header, which sticks under the page's bar with
// the header below it, so the box keeps its top edge while the rows run under it. Both stay inside the section,
// so they leave only once all of it has. The rest of the edge starts where the strip ends. The strip is as tall
// as the box's corners are round, so its corners curve as fully as the bottom ones
const BOX_TOP_HEIGHT = '0.5rem'
const BOX_TOP: CSSProperties = {
  ...REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
  height: BOX_TOP_HEIGHT,
  borderTop: BOX_EDGE_LINE,
  borderInline: BOX_EDGE_LINE,
  background: 'var(--app-surface-soft)',
}
const BOX_EDGE: CSSProperties = {
  ...BOX_AROUND_THE_SECTION,
  top: BOX_TOP_HEIGHT,
  borderInline: BOX_EDGE_LINE,
  borderBottom: BOX_EDGE_LINE,
}

// Widens the icon's slot by as much as the open rail outgrows it, so the label starts level with the day
// headings' dates in selection too. The rail is 2.5rem and the slot sits 0.75rem into it
const UPCOMING_ICON_SLOT_WIDTH = `max(1rem, calc(${TRANSACTION_CHECKBOX_RAIL} - 0.75rem))`

// The explanation is text the dates line up with, so it moves over with them when the rail opens
const EXPLANATION_ACROSS_THE_LIST: CSSProperties = {
  ...REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
  paddingLeft: `calc(0.75rem + ${TRANSACTION_CHECKBOX_RAIL})`,
  paddingRight: '0.75rem',
}

/**
 * Describes when the upcoming transactions fall, as one date or as the range from the first to the last,
 * short enough to sit beside the count on one line on a phone
 */
function describeUpcomingDates(transactionDates: string[], today: string): string {
  const sorted = [...transactionDates].sort()
  return formatShortDateRangeLabel(sorted[0], sorted[sorted.length - 1], Number(today.slice(0, 4)))
}

/**
 * Gathers a list's transactions dated after today under one collapsible section, faded, with a line
 * saying why they don't count yet
 *
 * Renders nothing when there are none. The owner decides which transactions go in and whether the
 * section is open, since a list may change what else it offers while the rows are hidden
 *
 * @param transactionDates - Each upcoming transaction's "YYYY-MM-DD" date, one per transaction
 * @param today - The user's today as "YYYY-MM-DD", so the dates name a year only when it isn't this one
 * @param gridClassName - Placement for each layer of the section, so a list on a CSS grid keeps the
 * rows inside on its own column tracks
 * @param stickyTop - Where the page's own sticky bar ends, in pixels. The header sticks there while the
 * section is open, so it can be closed again from anywhere in a long run of upcoming rows
 */
export function UpcomingSection({
  transactionDates,
  today,
  expanded,
  onToggle,
  gridClassName = '',
  stickyTop,
  children,
}: {
  transactionDates: string[]
  today: string
  expanded: boolean
  onToggle: () => void
  gridClassName?: string
  stickyTop?: number
  children: ReactNode
}) {
  const sectionRef = useRef<HTMLDivElement>(null)
  if (transactionDates.length === 0) return null

  // Closing from inside a long open section would leave the header above the screen once the rows go,
  // so the page first comes back to where the section starts, which is where the stuck header already is
  function handleToggle() {
    if (expanded && stickyTop !== undefined && (sectionRef.current?.getBoundingClientRect().top ?? 0) < stickyTop) {
      sectionRef.current?.scrollIntoView({ block: 'start' })
    }
    onToggle()
  }

  return (
    // Never a scroll anchor, so the browser doesn't move the page to hold a row in place while the section
    // closes, which pushed the header back under the toolbar
    <div ref={sectionRef} className={`${gridClassName} relative isolate mb-3 pb-2`} style={{ scrollMarginTop: stickyTop, overflowAnchor: 'none', ...DAY_TOTAL_MIX }}>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 -z-10 rounded-lg" style={BOX_SHADING} />
      <span aria-hidden className="pointer-events-none absolute bottom-0 z-20 rounded-b-lg" style={BOX_EDGE} />
      <div
        aria-hidden
        className={`${stickyTop === undefined ? '' : 'sticky'} pointer-events-none z-20 col-span-full rounded-t-lg`}
        style={{ ...BOX_TOP, top: stickyTop }}
      />
      <CollapsibleSection
        icon={CalendarClock}
        label="Upcoming"
        summary={
          // The count as a pill and the dates in short form, like the archived sections' headers, so the
          // header holds one line on a phone. The dates wrap under the count only when a range names years
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2">
            <CollapsibleSectionCount count={transactionDates.length} />
            <span className="whitespace-nowrap text-sm">
              {describeUpcomingDates(transactionDates, today)}
            </span>
          </span>
        }
        expanded={expanded}
        onToggle={handleToggle}
        className={gridClassName}
        bodyClassName={gridClassName}
        iconSlotWidth={UPCOMING_ICON_SLOT_WIDTH}
        headerStyle={{
          ...HEADER_ACROSS_THE_LIST,
          borderTop: 'none',
          ...(stickyTop === undefined
            ? {}
            : { top: `calc(${stickyTop}px + ${BOX_TOP_HEIGHT})`, background: 'var(--app-surface-soft)' }),
        }}
      >
        {/* Inside a list that scrolls sideways, the explanation wraps to the visible width and stays in view.
            Its lines are balanced so the narrower box selection leaves never strands the last words */}
        <p
          className="sticky left-0 col-span-full max-w-[100cqw] pb-2 text-sm text-balance italic"
          style={{ color: 'var(--app-text-muted)', ...EXPLANATION_ACROSS_THE_LIST }}
        >
          {UPCOMING_EXPLANATION}
        </p>
        <div className={gridClassName} style={UPCOMING_ROW_COLOURS}>
          <FadedRowsContext.Provider value>{children}</FadedRowsContext.Provider>
        </div>
      </CollapsibleSection>
    </div>
  )
}
