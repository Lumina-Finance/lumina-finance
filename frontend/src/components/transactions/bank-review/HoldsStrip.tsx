import { useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, CircleSlash } from 'lucide-react'
import type { BankHold } from '@/api/bank-sync'
import { DetailPhrases } from '@/components/transactions/bank-review/DetailPhrases'
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
import { formatReviewDate } from '@/components/transactions/utils/bankReview'

const EXPLANATION = '$0.00 records, not in your ledger or balances'

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
  prefersReducedMotion: boolean | null
}

/**
 * The bank's records of no amount, closed until opened
 *
 * A zero amount can't be approved or put in the ledger, so these are kept apart from the review
 * block, for awareness only. A row offers nothing to do, and a record the bank drops leaves on its own
 */
export function BankHoldsStrip({
  holds,
  accountFor,
  showAccountNames,
  today,
  open,
  onToggleOpen,
  prefersReducedMotion,
}: BankHoldsStripProps) {
  const listId = useId()
  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']

  return (
    <section aria-label="Bank holds" className={BANK_BOX_CLASS}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={onToggleOpen}
        className={`${BANK_STRIP_HEADER_CLASS} ${open ? 'rounded-t-lg' : 'rounded-lg'}`}
      >
        <span className="flex shrink-0" style={{ width: ICON_SLOT_BESIDE_THE_CHECKBOX_RAIL }}>
          <CircleSlash size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm leading-6">
          <span className="font-medium" style={{ color: 'var(--app-text)' }}>
            {holds.length.toLocaleString()} {holds.length === 1 ? 'hold' : 'holds'}
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
              <AnimatePresence initial={false}>
                {holds.map((hold) => {
                  const details = [
                    formatReviewDate(hold.date, today),
                    showAccountNames && accountFor(hold.account_id).name,
                  ]
                  return (
                    <motion.li
                      key={hold.id}
                      className="overflow-hidden"
                      initial={collapsed}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={leave}
                      transition={enterTransition}
                    >
                      {/* The divider runs from edge to edge, as the Upcoming box's rows' do */}
                      <div
                        className="px-3 py-2.5"
                        style={{
                          borderTop: '1px dashed var(--app-border-strong)',
                          paddingLeft: TEXT_INSET_PAST_THE_CHECKBOX_RAIL,
                        }}
                      >
                        <p className="break-words text-sm italic" style={{ color: 'var(--app-text-muted)' }}>
                          {hold.description}
                        </p>
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                          <DetailPhrases phrases={details} />
                        </p>
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
      <span aria-hidden className={BANK_BOX_EDGE_CLASS} style={{ borderColor: 'var(--app-border-strong)' }} />
    </section>
  )
}
