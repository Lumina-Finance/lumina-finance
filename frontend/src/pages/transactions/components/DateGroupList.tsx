import { AnimatePresence, motion } from 'motion/react'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import TransactionRow from '@/components/transactions/Row'
import { TRANSACTION_LIST_EASE } from '@/pages/transactions/constants/transactionList'
import type { TransactionDateGroup, TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { getTransactionDateGroupTotal } from '@/pages/transactions/utils/transactionDateGroups'

/**
 * Renders grouped transaction rows with sticky date totals
 */
export default function TransactionDateGroupList({
  dateGroups,
  categoryMap,
  accountMap,
  fixedAccount,
  currency,
  listRevealKey,
  stickyTop,
  prefersReducedMotion,
  skipEnterAnimation = false,
  onEditTransaction,
}: {
  dateGroups: TransactionDateGroup[]
  categoryMap: Map<string, Category>
  accountMap: Map<string, TransactionListAccount>
  fixedAccount?: TransactionListAccount
  currency: string
  listRevealKey: number
  stickyTop: number
  prefersReducedMotion: boolean | null
  // Makes a newly added row or group appear without the grow in, used for a lazy loaded page of rows
  skipEnterAnimation?: boolean
  onEditTransaction: (transaction: Transaction) => void
}) {
  const { formatCurrency } = useMoneyFormatters()

  return (
    <div className="min-[1300px]:grid min-[1300px]:grid-cols-[2.5rem_fit-content(24rem)_fit-content(18rem)_minmax(0,1fr)_max-content_max-content] min-[1300px]:gap-x-3">
      {/* initial={false} suppresses the first render and the whole-list swap on filter changes, so a
          group only animates here when it is genuinely added (a new day's first transaction) or removed
          (its last transaction deleted) while the list stays mounted */}
      <AnimatePresence initial={false}>
        {dateGroups.map(({ dateLabel, transactions }) => {
          const dailyTotal = getTransactionDateGroupTotal(transactions, fixedAccount)
          const dailyColor = dailyTotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
          return (
            <motion.div
              key={`${dateLabel}-${listRevealKey}`}
              className="min-[1300px]:col-span-full min-[1300px]:grid min-[1300px]:grid-cols-subgrid"
              initial={skipEnterAnimation ? false : prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      height: 0,
                      overflow: 'hidden',
                      transition: { duration: 0.26, ease: TRANSACTION_LIST_EASE },
                    }
              }
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: TRANSACTION_LIST_EASE }}
            >
            <div
              className="sticky z-20 flex items-center justify-between rounded-lg px-3 py-2 min-[1300px]:col-span-full"
              style={{
                top: stickyTop,
                background: 'var(--app-input-bg)',
                borderBottom: '1px solid var(--app-border)',
              }}
            >
              <p
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                {dateLabel}
              </p>
              <p
                className="font-financial text-sm font-medium"
                style={{ color: dailyColor }}
              >
                {formatCurrency(dailyTotal, currency)}
              </p>
            </div>

            <AnimatePresence initial={false}>
              {transactions.map((transaction) => {
                const category = categoryMap.get(transaction.category_id)
                const rowAccount = fixedAccount ?? accountMap.get(transaction.account_id)

                // Always from the full account list, since the counterparty account of a transfer is
                // often an account the current view is not showing
                const counterpartyAccount = transaction.counterparty_account_id
                  ? accountMap.get(transaction.counterparty_account_id)
                  : undefined
                const readOnlyReason = rowAccount?.is_archived ? 'Archived · Read-only' : undefined
                return (
                  <TransactionRow
                    key={transaction.id}
                    accountInstitution={rowAccount?.institution}
                    accountName={rowAccount?.name}
                    counterpartyAccountName={counterpartyAccount?.name}
                    category={category}
                    currency={transaction.currency}
                    readOnlyReason={readOnlyReason}
                    transaction={transaction}
                    prefersReducedMotion={prefersReducedMotion}
                    skipEnterAnimation={skipEnterAnimation}
                    onOpen={onEditTransaction}
                  />
                )
              })}
            </AnimatePresence>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
