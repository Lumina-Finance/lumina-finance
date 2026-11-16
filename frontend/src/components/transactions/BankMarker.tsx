import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Landmark } from 'lucide-react'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { CONTENT_EASE_CURVE, QUICK_EASE_S } from '@/utils/widthEase'

// As wide as its longest line, with room for the edited note on one line rather than a last line
// of two words, while staying narrower than a phone's page
const PANEL_WIDTH_CLASS = 'w-max max-w-80'

// The icon's size after a title, and among the note and tag icons the size they take
const TITLE_ICON_SIZE_PX = 13
const ICONS_SIZE_PX = 14

/**
 * What a transaction row shows about a bank-imported transaction
 */
export type TransactionRowBankMarker = {
  providerName: string

  /** The user has changed a value the bank supplied */
  isEdited: boolean

  /** The bank proposed a correction or removal that is waiting in the review block */
  needsReview: boolean

  /** Scrolls to the waiting item, called from the Needs review marker */
  onShowReview?: () => void
}

/**
 * Marks a row as imported from a bank: a muted bank icon naming the provider in a tooltip that opens
 * on hover, keyboard focus or a press, a dot once the user has edited a bank value, and a Needs
 * review marker while a proposal waits
 *
 * Positioned, so it sits above the layer that stretches the row's title over the whole row and takes
 * its own presses. The row opens on a press anywhere on its content, so a press here stops rather
 * than opening the row as well, and the icon takes presses a few pixels around it, so a near miss
 * opens the tooltip rather than the row
 *
 * The icon takes the muted text colour, since it is a control and its strokes need 3:1 against the
 * page in both themes. The muted colour clears that by a wide margin
 *
 * After a title, the icon centres its drawing on the title's capitals, measured from the baseline, so
 * where a font puts its capitals in the line can't move it. The pill's text shares that baseline, so a
 * line set on its baseline keeps its height when the pill appears. Among the note and tag icons, the
 * icon takes their size and centres with them
 */
export function BankMarker({
  providerName,
  isEdited,
  needsReview,
  onShowReview,
  placement,
}: TransactionRowBankMarker & { placement: 'title' | 'icons' }) {
  const afterTitle = placement === 'title'
  const size = afterTitle ? TITLE_ICON_SIZE_PX : ICONS_SIZE_PX
  return (
    <span
      className={`relative inline-flex shrink-0 gap-1.5 ${afterTitle ? 'items-baseline' : 'items-center'}`}
      onClick={(event) => event.stopPropagation()}
    >
      {/* With nothing but the icon inside, this box's baseline is its bottom, so the row stands it on
          the title's baseline. The drawing is centred in the box, so lowering it by half of what the box
          is taller than the capitals centres the drawing on them. The drawing starts 2/24 of the icon
          inside the box, so pulling the box back by that leaves it 4px after the title */}
      <span
        className="relative inline-flex"
        style={
          afterTitle ? { translate: `0 calc((${size}px - 1cap) / 2)`, marginLeft: `${-(size * 2) / 24}px` } : undefined
        }
      >
        {/* The panel is hidden from a screen reader while closed, so the name says what the dot does */}
        <IconTooltip
          label={isEdited ? `From ${providerName}, edited` : `From ${providerName}`}
          icon={Landmark}
          iconColor="var(--app-text-muted)"
          size={size}
          strokeWidth={2}
          widthClassName={PANEL_WIDTH_CLASS}
          hoverFill={false}
          widensHitArea
          focusRing
          hidesClosedPanel
          avoidsLoneWord
          picksSideOnPress
          clearsStickyBars
        >
          <span className="block">From {providerName}</span>
          {isEdited && <span className="mt-0.5 block">You edited a value from the bank</span>}
        </IconTooltip>
        <Grows show={isEdited} className="pointer-events-none absolute -right-1 -top-0.5 h-1.5 w-1.5">
          <span
            data-testid="bank-edited-dot"
            className="block h-full w-full rounded-full"
            style={{ background: 'var(--app-accent)' }}
          />
        </Grows>
      </span>
      {/* Takes presses a few pixels above and below, making it at least 24px tall to a finger, but
          none to its sides, so its edge still meets the icon's wider area. Hovering lays the row's
          hover tint over its own */}
      <Grows show={needsReview} className="inline-flex">
        <button
          type="button"
          aria-label="Needs review. Show the waiting item"
          onClick={onShowReview}
          className="relative inline-flex cursor-pointer items-center rounded-full border bg-[var(--app-warning-soft)] px-1.5 py-0.5 text-xs font-medium leading-none transition-control before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:bg-[var(--app-accent-soft)] after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-100 motion-reduce:transition-none motion-reduce:after:transition-none"
          style={{ borderColor: 'var(--app-warning-border)', color: 'var(--app-warning-text)' }}
        >
          Needs review
        </button>
      </Grows>
    </span>
  )
}

/**
 * Grows its content in and shrinks it away as `show` changes, so a pill or dot never pops. A marker
 * already showing as the row renders does not animate, and reduced motion makes the change instant
 */
function Grows({ show, className, children }: { show: boolean; className: string; children: ReactNode }) {
  const prefersReducedMotion = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          key="shown"
          className={className}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: prefersReducedMotion ? 0 : QUICK_EASE_S, ease: CONTENT_EASE_CURVE }}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
