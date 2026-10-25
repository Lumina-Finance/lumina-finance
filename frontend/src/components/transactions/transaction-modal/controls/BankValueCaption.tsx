import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { DETAILS_LINE_TRANSITION } from '@/components/transactions/transaction-modal/constants'
import { revealIfHidden } from '@/components/transactions/transaction-modal/utils/reveal'

type BankValueCaptionProps = {
  /** Names the bank's value, which the restore action is described by, telling the date's from the amount's */
  id: string

  /** Names the restore action, which focus returns to when a restore fails */
  actionId: string

  /** The bank's value as it reads, or null while the field isn't edited, which hides the caption */
  bankValue: string | null

  /** Sets the value in the figures' typeface, for an amount */
  financial?: boolean

  /** Why the bank's value can't be put back, for one the ledger can't store, or null where it can be */
  unavailableReason: string | null

  /** Says the last restore of this field failed, under the caption, or null */
  error: string | null
  restoring: boolean
  disabled: boolean
  onRestore: () => void
}

/**
 * Shows the bank's value under a field the user edited, with an action that puts it back
 *
 * The text and the action take the muted colour, which keeps them above 4.5:1 against the modal in
 * both themes, and the action is underlined, so it reads as one without the accent colour.
 * Its presses reach 24px tall through padding inside the caption, which clips nothing, while the line
 * of text stays as tall as the caption's own
 *
 * The action follows the value after a dot where both fit on one line, and otherwise starts a line of
 * its own, in line with the value and with no dot. A restore that fails says so under the caption, by
 * the field it was restoring rather than at the foot of the form, out of sight on a phone
 *
 * For a value the ledger can't store, the action shows greyed out and gives its reason beside the
 * pointer, or under it for the keyboard, as the app's other unavailable actions do. Only its label
 * fades, so the focus ring around it keeps its full strength
 */
export default function TransactionBankValueCaption({
  id,
  actionId,
  bankValue,
  financial = false,
  unavailableReason,
  error,
  restoring,
  disabled,
  onRestore,
}: BankValueCaptionProps) {
  const prefersReducedMotion = useReducedMotion()
  const failureRef = useRef<HTMLParagraphElement>(null)

  return (
    <AnimatePresence initial={false}>
      {bankValue !== null && (
        <motion.div
          key="bank-value"
          // Reaches 4px past the field on each side, given back by the spacer inside, so the clip the
          // height animation needs leaves the action's focus ring room wherever the action sits
          className="-mx-1 overflow-hidden"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={DETAILS_LINE_TRANSITION}
        >
          {/* The room around the line sits in a spacer, since padding on the box whose height animates
              would stay behind once it closes */}
          <div className="px-1 py-0.5">
            {/* Each part starts with 16px kept for the dot before it, and the line starts 16px early to
                match, so a part that wraps to the start of a line has its dot cut off by the clip */}
            <p
              className="-ml-4 flex flex-wrap items-center text-xs leading-4"
              style={{ color: 'var(--app-text-muted)' }}
            >
              <span className="pl-4">
                <span id={id}>
                  Bank: <span className={financial ? 'font-financial' : undefined}>{bankValue}</span>
                </span>
              </span>
              <span className="inline-flex items-center">
                <span aria-hidden className="w-4 shrink-0 text-center">&middot;</span>
                <DisabledReasonButton
                  id={actionId}
                  onClick={onRestore}
                  // An unavailable action stays focusable, refused through aria-disabled instead, so the
                  // keyboard can reach its reason. It is described by the bank's value it restores, then
                  // by why it can't, where it can't
                  disabled={disabled || restoring}
                  disabledReason={unavailableReason}
                  aria-busy={restoring}
                  aria-describedby={id}
                  // Restoring keeps its full colour, since it says what is happening rather than that
                  // the action is unavailable. Focus scrolls the action in with room above and below it
                  // for its ring, which the edge of the modal's body would otherwise cut off. The ring
                  // sits against the action's edge, with no gap, since the clip around the line keeps
                  // only 2px above and below it
                  className={`inline-flex scroll-my-1 cursor-pointer items-center gap-1 border-0 bg-transparent py-1 font-medium focus-visible:outline-offset-0 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed ${restoring ? '' : 'disabled:opacity-60'}`}
                >
                  {restoring && (
                    <LoaderCircle size={12} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  )}
                  <span className={unavailableReason ? 'underline underline-offset-2 opacity-60' : 'underline underline-offset-2'}>
                    {restoring ? 'Restoring' : 'Restore bank value'}
                  </span>
                </DisabledReasonButton>
              </span>
            </p>
            <AnimatePresence initial={false}>
              {error && (
                <motion.p
                  ref={failureRef}
                  key="restore-error"
                  role="alert"
                  className="overflow-hidden text-xs font-medium leading-5"
                  style={{ color: 'var(--app-negative)' }}
                  // Named, so the end of the line's opening can be told from the end of its closing
                  variants={{
                    closed: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 },
                    open: { opacity: 1, height: 'auto' },
                  }}
                  initial="closed"
                  animate="open"
                  exit="closed"
                  transition={DETAILS_LINE_TRANSITION}
                  onAnimationComplete={(definition) => {
                    if (definition === 'open') revealIfHidden(failureRef.current, !!prefersReducedMotion)
                  }}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
