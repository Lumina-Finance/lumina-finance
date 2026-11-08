import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Landmark } from 'lucide-react'
import IconTooltip from '@/components/tooltips/IconTooltip'

// As wide as its longest line, with room for the edited note on one line rather than a last line
// of two words, while staying narrower than a phone's page
const PANEL_WIDTH_CLASS = 'w-max max-w-80'

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
 */
export function BankMarker({ providerName, isEdited, needsReview, onShowReview }: TransactionRowBankMarker) {
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      <span className="relative inline-flex">
        {/* The panel is hidden from a screen reader while closed, so the name says what the dot does */}
        <IconTooltip
          label={isEdited ? `From ${providerName}, edited` : `From ${providerName}`}
          icon={Landmark}
          iconColor="var(--app-text-muted)"
          size={13}
          strokeWidth={2}
          widthClassName={PANEL_WIDTH_CLASS}
          hoverFill={false}
          widensHitArea
          focusRing
        >
          <span className="block">From {providerName}</span>
          {isEdited && <span className="mt-0.5 block">You edited a value the bank supplied</span>}
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
          className="relative inline-flex cursor-pointer items-center rounded-full border bg-[var(--app-warning-soft)] px-1.5 py-0.5 text-xs font-medium leading-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-[image:linear-gradient(var(--app-accent-soft),var(--app-accent-soft))]"
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
          transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
