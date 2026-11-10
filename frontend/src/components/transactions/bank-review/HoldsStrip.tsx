import { useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, CircleSlash } from 'lucide-react'
import type { BankHold } from '@/api/bank-sync'
import { ReviewDecisionButton } from '@/components/transactions/bank-review/DecisionButton'
import { DetailPhrases } from '@/components/transactions/bank-review/DetailPhrases'
import type { ReviewItemAccount } from '@/components/transactions/bank-review/ReviewBlock'
import { REVIEW_MOTION } from '@/components/transactions/constants/bankReview'
import { formatReviewDate } from '@/components/transactions/utils/bankReview'

const EXPLANATION = 'Records of no amount, left out of your ledger and balances'

type BankHoldsStripProps = {
  /** The holds in scope, newest first, each of an account the caller can name */
  holds: BankHold[]
  accountFor: (accountId: string) => ReviewItemAccount

  /** Left out on an account's own page, since every transaction there is that account's */
  showAccountNames: boolean

  /** Today as "YYYY-MM-DD" in the user's profile timezone. It decides whether a date shows its year */
  today: string
  open: boolean
  onToggleOpen: () => void

  /** The hold being dismissed now. Its button shows its spinner */
  dismissingId: string | null
  onDismiss: (holdId: string) => void
  prefersReducedMotion: boolean | null
}

/**
 * The bank's records of no amount, closed until opened, with a Dismiss for each
 *
 * A zero amount can't be approved or put in the ledger, so these are kept apart from the review
 * block, for awareness only. A row opens nothing. Dismissing takes two presses and stops the same
 * record coming back, and a record the bank drops leaves on its own
 */
export function BankHoldsStrip({
  holds,
  accountFor,
  showAccountNames,
  today,
  open,
  onToggleOpen,
  dismissingId,
  onDismiss,
  prefersReducedMotion,
}: BankHoldsStripProps) {
  const listId = useId()
  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']

  return (
    <section
      aria-label="Bank holds"
      className="overflow-hidden rounded-2xl border border-dashed"
      style={{ borderColor: 'var(--app-border-strong)' }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={onToggleOpen}
        className={`flex w-full items-center gap-2.5 px-4 py-3 text-left text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:bg-transparent! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)] motion-reduce:transition-none sm:px-5 ${open ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      >
        <CircleSlash size={15} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-medium" style={{ color: 'var(--app-text)' }}>
            {holds.length.toLocaleString()} {holds.length === 1 ? 'hold' : 'holds'}
          </span>
          <span className="hidden sm:inline"> · {EXPLANATION}</span>
        </span>
        <motion.span
          aria-hidden
          className="inline-flex shrink-0"
          animate={{ rotate: open ? 180 : 0 }}
          transition={enterTransition}
        >
          <ChevronDown size={16} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="list"
            id={listId}
            className="overflow-hidden"
            initial={collapsed}
            animate={{ height: 'auto', opacity: 1 }}
            exit={leave}
            transition={enterTransition}
          >
            <p className="px-4 pb-3 text-xs sm:hidden" style={{ color: 'var(--app-text-muted)' }}>
              {EXPLANATION}.
            </p>
            <ul>
              <AnimatePresence initial={false}>
                {holds.map((hold) => {
                  const details = [
                    formatReviewDate(hold.date, today),
                    showAccountNames && accountFor(hold.account_id).name,
                  ]
                  return (
                    <motion.li
                      key={hold.id}
                      className="overflow-hidden px-4 sm:px-5"
                      initial={collapsed}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={leave}
                      transition={enterTransition}
                    >
                      {/* The divider sits on the content rather than the row, so it stops short of the card's edges */}
                      <div
                        className="flex items-center gap-3 py-2.5"
                        style={{ borderTop: '1px dashed var(--app-border-strong)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm italic" style={{ color: 'var(--app-text-muted)' }}>
                            {hold.description}
                          </p>
                          <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                            <DetailPhrases phrases={details} />
                          </p>
                        </div>
                        <ReviewDecisionButton
                          label="Dismiss"
                          tone="danger"
                          loading={dismissingId === hold.id}
                          disabled={dismissingId !== null}
                          onClick={() => onDismiss(hold.id)}
                          confirm={{
                            label: 'Yes, dismiss',
                            announcement: 'Press again to dismiss this hold for good.',
                          }}
                          testId="bank-hold-dismiss"
                        />
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
