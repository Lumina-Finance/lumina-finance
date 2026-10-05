import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'

// The app's ease-out, for the caption opening and closing
const CAPTION_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const

interface BankValueCaptionProps {
  /** Names the bank's value, which the restore action is described by, telling the date's from the amount's */
  id: string

  /** The bank's value as it reads, or null while the field isn't edited, which hides the caption */
  bankValue: string | null

  /** Sets the value in the figures' typeface, for an amount */
  financial?: boolean
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
 */
export default function TransactionBankValueCaption({
  id,
  bankValue,
  financial = false,
  restoring,
  disabled,
  onRestore,
}: BankValueCaptionProps) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {bankValue !== null && (
        <motion.div
          key="bank-value"
          className="overflow-hidden"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={CAPTION_TRANSITION}
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
                disabled={disabled || restoring}
                aria-busy={restoring}
                aria-describedby={id}
                // Restoring keeps its full colour, since it says what is happening rather than that
                // the action is unavailable
                className={`inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent py-1 font-medium underline underline-offset-2 disabled:cursor-not-allowed ${restoring ? '' : 'disabled:opacity-60'}`}
              >
                {restoring && (
                  <LoaderCircle size={12} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
                )}
                {restoring ? 'Restoring' : 'Restore bank value'}
              </button>
            </span>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
