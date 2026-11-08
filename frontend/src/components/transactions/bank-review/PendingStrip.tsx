import { useId, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Clock } from 'lucide-react'
import type { PendingBankTransaction } from '@/api/bank-sync'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useRelativeTimeRefresh } from '@/hooks/useRelativeTimeRefresh'
import { ReadFailureNotice, type BankReadFailure } from '@/components/transactions/bank-review/ReadFailureNotice'
import type { ReviewItemAccount } from '@/components/transactions/bank-review/ReviewBlock'
import { REVIEW_MOTION } from '@/components/transactions/constants/bankReview'
import { useFocusAfterRetry } from '@/components/transactions/hooks/useFocusAfterRetry'
import { formatRawAmount, formatReviewDate } from '@/components/transactions/utils/bankReview'
import { formatRelativeTime } from '@/utils/relativeTime'

// Beside the count on the closed strip, and inside the opened one on phones. It doesn't fit beside the count there
const EXPLANATION = 'Not in your balance until the bank settles them'

type BankPendingStripProps = {
  /** The pending transactions in scope, newest first, each of an account the caller can name */
  transactions: PendingBankTransaction[]

  /** Set while they have never loaded. The strip says so in place of its count and rows */
  failure: BankReadFailure | null
  accountFor: (accountId: string) => ReviewItemAccount

  /** Left out on an account's own page, since every transaction there is that account's */
  showAccountNames: boolean

  /** Today as "YYYY-MM-DD" in the user's profile timezone. It decides whether a date shows its year */
  today: string
  open: boolean
  onToggleOpen: () => void
  prefersReducedMotion: boolean | null
}

/**
 * The transactions the bank hasn't posted yet, muted and closed until opened, for awareness only
 *
 * They stay out of the ledger, review and every total, so a row shows its transaction and opens
 * nothing. Each says when the bank was last asked, since an account that can't sync keeps the ones
 * it had. A read that fails is said inside the strip rather than leaving it out
 */
export function BankPendingStrip({
  transactions,
  failure,
  accountFor,
  showAccountNames,
  today,
  open,
  onToggleOpen,
  prefersReducedMotion,
}: BankPendingStripProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const listId = useId()
  useRelativeTimeRefresh(() =>
    transactions.map((transaction) => formatRelativeTime(transaction.observed_at)).join('\n'),
  )
  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']

  // Transactions that load on a retry take focus on the strip's toggle, so focus doesn't drop to the
  // top of the page as the retry leaves
  const toggleRef = useRef<HTMLButtonElement>(null)
  const failureRef = useRef<HTMLDivElement>(null)
  useFocusAfterRetry(failure !== null, failureRef, () => toggleRef.current)

  const swap = {
    className: 'overflow-hidden',
    initial: collapsed,
    animate: { height: 'auto', opacity: 1 },
    exit: leave,
    transition: enterTransition,
  }

  return (
    <section
      aria-label="Pending bank transactions"
      className="overflow-hidden rounded-2xl border border-dashed"
      style={{ borderColor: 'var(--app-border-strong)' }}
    >
      <AnimatePresence initial={false}>
        {failure ? (
          <motion.div key="failure" {...swap}>
            <div ref={failureRef} className="px-4 py-3 sm:px-5">
              <ReadFailureNotice subject="Pending bank transactions" failure={failure} />
            </div>
          </motion.div>
        ) : (
          <motion.div key="transactions" {...swap}>
            {/* Rounded like the card at whichever corners it fills, so its focus ring follows them. Its
                muted words and icons lift to the full text colour over the hover tint */}
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              onClick={onToggleOpen}
              className={`flex w-full items-center gap-2.5 px-4 py-3 text-left text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)] motion-reduce:transition-none sm:px-5 ${open ? 'rounded-t-2xl' : 'rounded-2xl'}`}
            >
              <Clock size={15} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium" style={{ color: 'var(--app-text)' }}>
                  {transactions.length.toLocaleString()} pending
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
                    {transactions.map((transaction) => {
                      const account = accountFor(transaction.account_id)
                      const amount =
                        transaction.amount === null
                          ? formatRawAmount(transaction.raw_amount ?? '', account.currency).text
                          : formatMovedCurrency(transaction.amount, account.currency)
                      const details = [
                        formatReviewDate(transaction.date, today),
                        showAccountNames && account.name,
                        'Pending',
                      ]
                      return (
                        <li key={transaction.id} className="px-4 sm:px-5">
                          {/* The divider sits on the content rather than the row, so it stops short of the card's edges */}
                          <div
                            className="flex items-center gap-3 py-2.5"
                            style={{ borderTop: '1px dashed var(--app-border-strong)' }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm italic" style={{ color: 'var(--app-text-muted)' }}>
                                {transaction.description}
                              </p>
                              <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                                {details.filter(Boolean).join(' · ')}
                                {' · '}
                                {/* The relative time stays whole, so a narrow row wraps before it rather than inside it */}
                                <span className="whitespace-nowrap">
                                  Checked {formatRelativeTime(transaction.observed_at)}
                                </span>
                              </p>
                            </div>
                            <span
                              className="shrink-0 font-financial text-sm tabular-nums"
                              style={{ color: 'var(--app-text-muted)' }}
                            >
                              {amount}
                            </span>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
