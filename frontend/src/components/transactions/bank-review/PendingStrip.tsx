import { useId, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Clock } from 'lucide-react'
import type { PendingBankTransaction } from '@/api/bank-sync'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useRelativeTimeRefresh } from '@/hooks/useRelativeTimeRefresh'
import { DetailPhrases } from '@/components/transactions/bank-review/DetailPhrases'
import { ReadFailureNotice, type BankReadFailure } from '@/components/transactions/bank-review/ReadFailureNotice'
import type { ReviewItemAccount } from '@/components/transactions/bank-review/ReviewBlock'
import {
  BANK_BOX_CLASS,
  BANK_BOX_EDGE_CLASS,
  BANK_STRIP_HEADER_CLASS,
  REVIEW_MOTION,
} from '@/components/transactions/constants/bankReview'
import {
  ICON_SLOT_BESIDE_THE_CHECKBOX_RAIL,
  TEXT_INSET_PAST_THE_CHECKBOX_RAIL,
} from '@/components/transactions/constants/transactionList'
import { useFocusAfterRetry } from '@/components/transactions/hooks/useFocusAfterRetry'
import { formatBankAmount, formatReviewDate } from '@/components/transactions/utils/bankReview'
import { formatRelativeTime } from '@/utils/relativeTime'

// Beside the count on the closed strip, and inside the opened one on phones. It doesn't fit beside the count there
const EXPLANATION = 'Not in your balance until settlement'

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
    <section aria-label="Pending bank transactions" className={BANK_BOX_CLASS}>
      <AnimatePresence initial={false}>
        {failure ? (
          <motion.div key="failure" {...swap}>
            {/* Moves past the checkbox rail with the rows' text, as the review block's notices do */}
            <div ref={failureRef} className="p-3" style={{ paddingLeft: TEXT_INSET_PAST_THE_CHECKBOX_RAIL }}>
              <ReadFailureNotice subject="Pending bank transactions" failure={failure} />
            </div>
          </motion.div>
        ) : (
          <motion.div key="transactions" {...swap}>
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              onClick={onToggleOpen}
              className={`${BANK_STRIP_HEADER_CLASS} ${open ? 'rounded-t-lg' : 'rounded-lg'}`}
            >
              <span className="flex shrink-0" style={{ width: ICON_SLOT_BESIDE_THE_CHECKBOX_RAIL }}>
                <Clock size={16} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-sm leading-6">
                <span className="font-medium" style={{ color: 'var(--app-text)' }}>
                  {transactions.length.toLocaleString()} pending
                </span>
                <span className="hidden sm:inline"> · {EXPLANATION}</span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden
                className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
              />
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
                  <p
                    className="px-3 pb-2 text-xs sm:hidden"
                    style={{ color: 'var(--app-text-muted)', paddingLeft: TEXT_INSET_PAST_THE_CHECKBOX_RAIL }}
                  >
                    {EXPLANATION}.
                  </p>
                  <ul>
                    {transactions.map((transaction) => {
                      const account = accountFor(transaction.account_id)
                      const amount = formatBankAmount(transaction, account.currency, formatMovedCurrency)
                      const details = [
                        formatReviewDate(transaction.date, today),
                        showAccountNames && account.name,
                        'Pending',
                        `Checked ${formatRelativeTime(transaction.observed_at)}`,
                      ]
                      return (
                        <li key={transaction.id}>
                          {/* The divider runs from edge to edge, as the Upcoming box's rows' do */}
                          <div
                            className="flex items-center gap-3 px-3 py-2.5"
                            style={{
                              borderTop: '1px dashed var(--app-border-strong)',
                              paddingLeft: TEXT_INSET_PAST_THE_CHECKBOX_RAIL,
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm italic" style={{ color: 'var(--app-text-muted)' }}>
                                {transaction.description}
                              </p>
                              <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                                <DetailPhrases phrases={details} />
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
      <span aria-hidden className={BANK_BOX_EDGE_CLASS} style={{ borderColor: 'var(--app-border-strong)' }} />
    </section>
  )
}
