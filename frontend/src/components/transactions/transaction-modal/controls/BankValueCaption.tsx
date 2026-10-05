import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { useDisabledReason } from '@/hooks/useDisabledReason'
import { DETAILS_LINE_TRANSITION } from '@/pages/transactions/components/transaction-modal/constants'

type BankValueCaptionProps = {
  /** Names the bank's value, which the restore action is described by, telling the date's from the amount's */
  id: string

  /** The bank's value as it reads, or null while the field isn't edited, which hides the caption */
  bankValue: string | null

  /** Sets the value in the figures' typeface, for an amount */
  financial?: boolean

  /** Why the bank's value can't be put back, for one the ledger can't store, or null where it can be */
  unavailableReason: string | null
  restoring: boolean
  disabled: boolean
  onRestore: () => void
}

/**
 * Shows the bank's value under a field the user edited, with an action that puts it back
 *
 * The text and the action take the muted colour rather than the accent, which misses 4.5:1 against
 * the modal in the light theme, and the action is underlined, so it reads as one without its colour.
 * Its presses reach 24px tall through padding inside the caption, which clips nothing, while the line
 * of text stays as tall as the caption's own
 *
 * For a value the ledger can't store, the action shows greyed out and gives its reason beside the
 * pointer, or under it for the keyboard, as the app's other unavailable actions do. Only its label
 * fades, so the focus ring around it keeps its full strength
 */
export default function TransactionBankValueCaption({
  id,
  bankValue,
  financial = false,
  unavailableReason,
  restoring,
  disabled,
  onRestore,
}: BankValueCaptionProps) {
  const prefersReducedMotion = useReducedMotion()
  const { controlProps, tooltip } = useDisabledReason(unavailableReason)

  // The action is described by the bank's value it restores, then by why it can't, where it can't
  const describedBy = [id, controlProps['aria-describedby']].filter(Boolean).join(' ')

  return (
    <AnimatePresence initial={false}>
      {bankValue !== null && (
        <motion.div
          key="bank-value"
          // The padding below, given back by the negative margin so nothing moves, leaves the action's
          // focus ring room inside the clip the height animation needs, which would otherwise cut its
          // bottom edge off
          className="-mb-1 overflow-hidden pb-1"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={DETAILS_LINE_TRANSITION}
        >
          <p
            className="flex flex-wrap items-center gap-x-1.5 pt-0.5 text-xs leading-4"
            style={{ color: 'var(--app-text-muted)' }}
          >
            <span id={id}>
              Bank: <span className={financial ? 'font-financial' : undefined}>{bankValue}</span>
            </span>
            {/* The dot travels with the action, so a wrap never leaves it at the end of a line */}
            <span className="inline-flex items-center gap-x-1.5">
              <span aria-hidden>&middot;</span>
              <button
                type="button"
                onClick={onRestore}
                // An unavailable action stays focusable, refused through aria-disabled instead, so the
                // keyboard can reach its reason
                disabled={!unavailableReason && (disabled || restoring)}
                aria-busy={restoring}
                {...controlProps}
                aria-describedby={describedBy}
                // Restoring keeps its full colour, since it says what is happening rather than that
                // the action is unavailable
                className={`inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent py-1 font-medium disabled:cursor-not-allowed aria-disabled:cursor-not-allowed ${restoring ? '' : 'disabled:opacity-60'}`}
              >
                {restoring && (
                  <LoaderCircle size={12} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
                )}
                <span className={unavailableReason ? 'underline underline-offset-2 opacity-60' : 'underline underline-offset-2'}>
                  {restoring ? 'Restoring' : 'Restore bank value'}
                </span>
              </button>
              {tooltip}
            </span>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
