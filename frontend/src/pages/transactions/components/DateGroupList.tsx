import { motion } from 'motion/react'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import { formatCurrency } from '@/utils/formatCurrency'
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
  onEditTransaction: (transaction: Transaction) => void
}) {
  return (
    <div className="min-[1300px]:grid min-[1300px]:grid-cols-[2.5rem_fit-content(24rem)_fit-content(18rem)_minmax(0,1fr)_max-content_max-content] min-[1300px]:gap-x-3">
      {dateGroups.map(({ dateLabel, transactions }, groupIndex) => {
        const dailyTotal = getTransactionDateGroupTotal(transactions, fixedAccount)
        const dailyColor = dailyTotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
        return (
          <motion.div
            key={`${dateLabel}-${listRevealKey}`}
            className="min-[1300px]:col-span-full min-[1300px]:grid min-[1300px]:grid-cols-subgrid"
            initial={
              listRevealKey === 0 || prefersReducedMotion
                ? false
                : { opacity: 0 }
            }
            animate={{ opacity: 1 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.28,
              delay: prefersReducedMotion ? 0 : Math.min(groupIndex * 0.035, 0.18),
              ease: TRANSACTION_LIST_EASE,
            }}
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

            {transactions.map((transaction) => {
              const category = categoryMap.get(transaction.category_id)
              const rowAccount = fixedAccount ?? accountMap.get(transaction.account_id)
              const readOnlyReason = rowAccount?.is_archived ? 'Archived · Read-only' : undefined
              return (
                <TransactionRow
                  key={transaction.id}
                  accountInstitution={rowAccount?.institution}
                  accountName={rowAccount?.name}
                  category={category}
                  currency={transaction.currency}
                  readOnlyReason={readOnlyReason}
                  transaction={transaction}
                  onOpen={onEditTransaction}
                />
              )
            })}
          </motion.div>
        )
      })}
    </div>
  )
}
