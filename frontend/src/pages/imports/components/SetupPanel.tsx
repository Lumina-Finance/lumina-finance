import { useId, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { IMPORT_SETUP_MOTION_MS } from '@/pages/imports/constants'
import { useImportSetupPanel } from '@/pages/imports/hooks/useImportSetupPanel'

// The page's usual ease, at the duration of the whole collapse. Every part of the panel moves in it,
// so the sections, the label and the steps beside or below the panel arrive together
const PANEL_MOTION = 'duration-(--setup-motion) ease-[var(--app-dropdown-ease)] motion-reduce:transition-none'

// The geometry of the header, in px and from the padding edge of the header button, which is what its
// children are placed from. On desktop the header is a row on top of the sections while they show and
// the strip while they do not. Its label and caret stay where the row has them and are moved to the
// strip with transforms, so they travel there and the strip is where they land to the pixel. Below
// desktop it is the same row throughout, which the sections close up under
const BORDER = 1
const STRIP_WIDTH = 28
const ROW_HEIGHT = 36
const ROW_INSET = 8
const CARET_SIZE = 16
const LABEL_LINE_HEIGHT = 16
const STRIP_PADDING_TOP = 16
const STRIP_GAP = 16
const SECTIONS_TOP = 44

// The page's gap between its columns and rows, and the narrower one the steps keep from the collapsed
// panel, which is the strip's width again so the thin strip is not set apart by more room than it
// takes. The panel's margin takes the difference back while it is collapsed
const PAGE_GAP = 32
const COLLAPSED_GAP = 16

// How far the sections rise as they close up under the bar below desktop, while they fade
const SECTIONS_RISE = 16

// The room the focus rings of the sections' edges keep inside the box that scrolls them, which the
// sheet's clip leaves them too
const RING_ROOM = 4

// The sections' own gutter on their right, beside the scrolling box of the files step. The sheet
// reaches past the sections' column by the collapsed gap less this, so what they show keeps the
// same room from the sheet's edge as the steps keep from the strip
const SECTIONS_GUTTER = 4
const SHEET_ROOM = COLLAPSED_GAP - SECTIONS_GUTTER

const STRIP_CENTER = (STRIP_WIDTH - 2 * BORDER) / 2
const ROW_CARET_TOP = (ROW_HEIGHT - 2 * BORDER - CARET_SIZE) / 2
const ROW_LABEL_TOP = (ROW_HEIGHT - 2 * BORDER - LABEL_LINE_HEIGHT) / 2

// The caret hangs from the row's left edge by the open width, so it does not slide with the header's
// width as that changes. In the strip it is centred under the top padding. Below desktop the row is
// as wide as the page's column, so the caret is placed from its right edge
const CARET_LEFT = `calc(var(--setup-open-width) - ${2 * BORDER + ROW_INSET + CARET_SIZE}px)`
const STRIP_CARET_LEFT = STRIP_CENTER - CARET_SIZE / 2
const CARET_IN_STRIP = `calc(${STRIP_CARET_LEFT + 2 * BORDER + ROW_INSET + CARET_SIZE}px - var(--setup-open-width)) ${STRIP_PADDING_TOP - ROW_CARET_TOP}px`
const BAR_CARET_LEFT = `calc(100% - ${ROW_INSET + CARET_SIZE}px)`

// The label turns a quarter turn about its top right corner, which then sits where its text ends, at
// the top of the strip under the caret, with the line centred in the strip. Its width is the one thing
// not known, so the corner is moved by the label's own width
const LABEL_IN_STRIP = `calc(-100% + ${STRIP_CENTER - LABEL_LINE_HEIGHT / 2 - ROW_INSET}px) ${STRIP_PADDING_TOP + CARET_SIZE + STRIP_GAP - ROW_LABEL_TOP}px`

// A thin edge on the right of the sheet while the panel lies over the steps, to part it from them
const OVER_STEPS_EDGE = '1px 0 0 var(--app-border), 8px 0 16px -10px var(--app-border)'

/**
 * The import page's setup column, holding the data source and the files, which collapses to give the
 * steps more room
 *
 * Wherever the steps sit beside the setup (desktop) it collapses to a narrow strip on the left. The
 * strip holds a caret and a vertical label, and its click expands the panel again. Collapsing is one
 * transition: the sections fade out towards the left while sliding left, the label and caret travel
 * from their row above the sections to the strip and turn there, and the steps widen into the room.
 * Expanding plays it backwards. The panel collapses by itself once a file is staged and returns to
 * its place over the steps, on the page's own background and without moving them, while the pointer is
 * on it or focus, a field error, a dropdown or a date calendar in use holds it there. Taking its place again, by the
 * caret or by the last file going, moves the steps beside it, at once when it already lay over them
 *
 * Wherever the steps sit below the setup it collapses upwards instead, into a thin bar the width of
 * the page above the steps, which keeps the label and caret in the row they had. The sections fade
 * and rise as their room closes up and the steps move up into it, and expanding plays it backwards.
 * Only the caret collapses or expands it there, with no hover. Contents stay mounted while
 * collapsed, so nothing typed or chosen in them is lost, and are made inert so the keyboard cannot
 * reach what is out of sight
 *
 * @param hasFile - Whether a file is staged, which collapses the panel on desktop
 */
export function ImportSetupPanel({ hasFile, onPointerInsideChange, children }: {
  hasFile: boolean
  onPointerInsideChange?: (isInside: boolean) => void
  children: ReactNode
}) {
  const panelId = useId()
  const { panelRef, isDesktop, isCollapsed, isOpen, isPlacedAtOnce, toggle, peekHandlers } = useImportSetupPanel(hasFile, onPointerInsideChange)

  // The strip the steps sit beside, and the bar they sit below
  const isStrip = isDesktop && isCollapsed

  // Back over the steps, which it does not move while the pointer or a hold keeps it there
  const isOverSteps = isStrip && isOpen

  // The room taken back from the page's gap, to the right of the strip and below the bar
  const collapsedMargin: CSSProperties = isDesktop
    ? { marginRight: isStrip ? COLLAPSED_GAP - PAGE_GAP : 0 }
    : { marginBottom: isCollapsed ? COLLAPSED_GAP - PAGE_GAP : 0 }

  const header = (
    <button
      type="button"
      className={`app-icon-button z-20 transition-[background-color,border-color,color] ${PANEL_MOTION} ${isDesktop
        ? `absolute left-0 top-0 ${isOpen
          ? 'h-9 w-[var(--setup-open-width)]'
          : 'h-full w-(--setup-strip-width) hover:[background:transparent] hover:[border-color:transparent]'}`
        : `relative h-9 w-full ${isCollapsed ? '[border-color:var(--app-border)]' : ''}`}`}
      onClick={toggle}
      aria-label={isCollapsed ? 'Expand import setup' : 'Collapse import setup'}
      aria-expanded={!isCollapsed}
      aria-controls={panelId}
    >
      <span
        className={`absolute whitespace-nowrap text-xs font-semibold uppercase leading-4 origin-top-right transition-[translate,rotate] ${PANEL_MOTION}`}
        style={{
          left: ROW_INSET,
          top: ROW_LABEL_TOP,
          translate: isOpen || !isDesktop ? 'none' : LABEL_IN_STRIP,
          rotate: isOpen || !isDesktop ? 'none' : '-90deg',
        }}
      >
        Import setup
      </span>
      <ChevronLeft
        size={CARET_SIZE}
        className={`absolute transition-[translate,rotate] ${PANEL_MOTION}`}
        style={{
          left: isDesktop ? CARET_LEFT : BAR_CARET_LEFT,
          top: ROW_CARET_TOP,
          translate: isOpen || !isDesktop ? 'none' : CARET_IN_STRIP,
          // Points the way the panel goes when clicked: left to collapse and right to expand on desktop,
          // up to collapse and down to expand below it
          rotate: isDesktop ? (isCollapsed ? '180deg' : 'none') : (isCollapsed ? '-90deg' : '90deg'),
        }}
        aria-hidden
      />
    </button>
  )

  return (
    <aside
      ref={panelRef}
      aria-label="Import setup"
      className={`relative flex flex-col [--setup-open-width:340px] ${PANEL_MOTION} ${isDesktop
        ? `h-full shrink-0 ${isPlacedAtOnce ? 'transition-none' : 'transition-[width,margin]'} ${isStrip ? 'w-(--setup-strip-width)' : 'w-[340px]'}`
        : 'transition-[margin]'}`}
      style={{
        '--setup-motion': `${IMPORT_SETUP_MOTION_MS}ms`,
        '--setup-strip-width': `${STRIP_WIDTH}px`,
        '--setup-sheet-width': `calc(var(--setup-open-width) + ${SHEET_ROOM}px)`,
        ...collapsedMargin,
      } as CSSProperties}
      {...peekHandlers}
    >
      {/* The strip's edge is drawn apart from the button that is its hit area, so it fades in whole rather than growing
          with the button, which changes size from the header row to the strip's full height. It is a hairline and no card,
          since a card does not read at this width. It lies over the sheet, which is as wide as the strip when closed */}
      {isDesktop && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 z-20 border-r transition-opacity ${PANEL_MOTION} [border-color:var(--app-border)] ${isOpen ? 'opacity-0' : 'opacity-100'}`}
          style={{ width: STRIP_WIDTH }}
        />
      )}
      {header}

      {/* One tree at both layouts, so what is typed in the sections survives the window crossing the breakpoint. On desktop it is
          the sheet: the page's background under the sections, which grows out of the strip to the open width and back with the
          panel's own motion and carries the edge that parts the panel from the steps, so the opaque area is never anything but
          what the sections cover. It keeps the room of a collapsed gap past what the sections show on the right. The sections inside are pinned to
          the open width at every state, so they never reflow as the sheet opens and closes, and slide along with its right edge
          as they fade. The sheet is absolute at the panel's top and as tall as the page, the sections scroll when they are taller,
          and the header button lies over its top. Below desktop it is the room under the bar, which closes up to nothing as a grid
          row, since its height is not known */}
      <div
        id={panelId}
        inert={!isOpen}
        className={`${PANEL_MOTION} ${isDesktop
          ? `absolute inset-y-0 left-0 z-10 flex flex-col transition-[width,box-shadow,visibility] [overflow:clip] [background:var(--app-bg)] ${isOpen ? 'w-(--setup-sheet-width)' : 'w-(--setup-strip-width)'}`
          : 'grid transition-[grid-template-rows,visibility]'} ${isOpen ? '' : 'invisible'}`}
        style={{
          paddingTop: isDesktop ? SECTIONS_TOP : undefined,
          gridTemplateRows: isDesktop ? undefined : isOpen ? '1fr' : '0fr',
          boxShadow: isOverSteps ? OVER_STEPS_EDGE : undefined,
          overflowClipMargin: isDesktop ? RING_ROOM : undefined,
        }}
      >
        {/* The side room, taken back by the margin, keeps the focus rings from being clipped. Below desktop the box clips
            the sections as the room closes, and carries no vertical padding, since a box animating to zero would leave it behind */}
        <div
          className={`relative min-h-0 ${isDesktop ? 'flex flex-1 flex-col' : '-mx-1 overflow-hidden px-1'}`}
          style={isDesktop ? { marginLeft: -RING_ROOM, width: `calc(var(--setup-sheet-width) + ${RING_ROOM}px)` } : undefined}
        >
          <div
            className={`flex flex-col gap-8 transition-[opacity,translate] ${PANEL_MOTION} ${isOpen ? 'opacity-100' : 'opacity-0'} ${isDesktop
              ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain'
              : 'pb-1 pt-4'}`}
            style={{
              translate: isOpen ? 'none' : isDesktop ? 'calc(var(--setup-strip-width) - var(--setup-sheet-width))' : `0 -${SECTIONS_RISE}px`,
              ...(isDesktop && { paddingLeft: RING_ROOM, paddingRight: SHEET_ROOM }),
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </aside>
  )
}
