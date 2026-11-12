import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePendingBankTransactions } from '@/api/bank-sync'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import { BankPendingStrip } from '@/components/transactions/bank-review/PendingStrip'
import type { BankReadFailure } from '@/components/transactions/bank-review/ReadFailureNotice'
import { REVIEW_MOTION } from '@/components/transactions/constants/bankReview'
import { useBankItemScope } from '@/components/transactions/hooks/useBankItemScope'

type BankPendingSectionProps = {
  /** The accounts the transaction list is filtered or fixed to, empty or absent when it shows every account */
  listAccountIds: string[] | undefined

  /** Set on an account's own page. Every transaction there is that account's, so rows leave its name out */
  isFixedAccount: boolean
  prefersReducedMotion: boolean | null
}

/**
 * The transactions the bank hasn't posted yet in the accounts a transaction list shows, in a strip
 * under the review block
 *
 * Hidden while none are pending. While they can't load, the strip says so with a retry, so an empty
 * space never reads as nothing pending. The bank sync heartbeat reads them again whenever a link
 * changes, so a sync that posts or drops one, or a link that has them cleared, shows on its own
 */
export const BankPendingSection = memo(function BankPendingSection({
  listAccountIds,
  isFixedAccount,
  prefersReducedMotion,
}: BankPendingSectionProps) {
  const today = useTodayYmd()
  const { accountIds, isInScope, accountById, accountFor } = useBankItemScope(listAccountIds)
  const { data, errorUpdateCount, isFetching, refetch } = usePendingBankTransactions(accountIds, isInScope)

  // A read that has failed and never succeeded. Read from the count of failures rather than the
  // error. A retry of a read with nothing loaded clears that while it runs, so the failure stays in
  // place, saying it is retrying, until it settles
  const failure: BankReadFailure | null =
    isInScope && errorUpdateCount > 0 && !data ? { retry: () => void refetch(), isRetrying: isFetching } : null
  const transactions = useMemo(
    () => (data ?? []).filter((transaction) => accountById.has(transaction.account_id)),
    [data, accountById],
  )

  // A strip that leaves, once nothing is pending, comes back closed as it first showed
  const [open, setOpen] = useState(false)
  if (open && transactions.length === 0) setOpen(false)

  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']

  return (
    <AnimatePresence initial={false}>
      {(transactions.length > 0 || failure) && (
        <motion.div
          key="pending"
          className="overflow-hidden"
          initial={collapsed}
          animate={{ height: 'auto', opacity: 1 }}
          exit={leave}
          transition={enterTransition}
        >
          <div className="pb-3 pt-1">
            <BankPendingStrip
              transactions={transactions}
              failure={failure}
              accountFor={accountFor}
              showAccountNames={!isFixedAccount}
              today={today}
              open={open}
              onToggleOpen={() => setOpen(!open)}
              prefersReducedMotion={prefersReducedMotion}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
