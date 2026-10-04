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
 * Marks a row as imported from a bank: a muted bank icon naming the provider in a tooltip, a dot once
 * the user has edited a bank value, and a Needs review marker while a proposal waits
 *
 * Everything here sits inside the row's own button, so each control is a focusable span acting as a
 * button, and its clicks stop with it rather than opening the row as well
 */
export function BankMarker({ providerName, isEdited, needsReview, onShowReview }: TransactionRowBankMarker) {
  const showReview = () => onShowReview?.()

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="relative inline-flex">
        <IconTooltip
          label={`From ${providerName}`}
          icon={Landmark}
          iconColor="var(--app-text-subtle)"
          size={13}
          strokeWidth={2}
          widthClassName="w-max max-w-60"
          hoverFill={false}
          insideControl
        >
          From {providerName}{isEdited && '. You edited a value the bank supplied'}
        </IconTooltip>
        {isEdited && (
          <span
            className="pointer-events-none absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--app-accent)' }}
          />
        )}
      </span>
      {needsReview && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Needs review. Show the waiting item"
          onClick={(event) => {
            event.stopPropagation()
            showReview()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            showReview()
          }}
          className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium leading-none"
          style={{
            borderColor: 'var(--app-warning-border)',
            background: 'var(--app-warning-soft)',
            color: 'var(--app-warning-text)',
          }}
        >
          Needs review
        </span>
      )}
    </span>
  )
}
