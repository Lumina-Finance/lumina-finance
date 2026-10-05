import { Landmark } from 'lucide-react'
import IconTooltip from '@/components/tooltips/IconTooltip'

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
 * than opening the row as well
 *
 * The icon takes the muted text colour rather than the subtle one, since it is a control and its
 * strokes need 3:1 against the page in both themes, which the subtle colour misses in the light one
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
          widthClassName="w-max max-w-60"
          hoverFill={false}
          opensOnFocus
        >
          <span className="block">From {providerName}</span>
          {isEdited && <span className="mt-0.5 block">You edited a value the bank supplied</span>}
        </IconTooltip>
        {isEdited && (
          <span
            data-testid="bank-edited-dot"
            className="pointer-events-none absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--app-accent)' }}
          />
        )}
      </span>
      {needsReview && (
        <button
          type="button"
          aria-label="Needs review. Show the waiting item"
          onClick={onShowReview}
          className="inline-flex cursor-pointer items-center rounded-full border px-1.5 py-0.5 text-xs font-medium leading-none"
          style={{
            borderColor: 'var(--app-warning-border)',
            background: 'var(--app-warning-soft)',
            color: 'var(--app-warning-text)',
          }}
        >
          Needs review
        </button>
      )}
    </span>
  )
}
