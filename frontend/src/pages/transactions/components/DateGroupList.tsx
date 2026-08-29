import { AnimatePresence, motion } from 'motion/react'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import TransactionRow, { type TransactionRowSelection } from '@/components/transactions/Row'
import {
  REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
  TRANSACTION_CHECKBOX_RAIL,
  TRANSACTION_CHECKBOX_RAIL_DURATION_S,
  TRANSACTION_CHECKBOX_RAIL_VARIABLE,
  TRANSACTION_CHECKBOX_RAIL_WIDTH,
  TRANSACTION_LIST_EASE,
} from '@/pages/transactions/constants/transactionList'
import type { TransactionDateGroup, TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { getTransactionDateGroupTotal } from '@/pages/transactions/utils/transactionDateGroups'
import { getTransactionReadOnlyReason } from '@/pages/transactions/utils/rowEditability'

// The six content tracks every row lines its cells up against, declared once and never added to.
// Selection mode opens a rail beside them instead, because a checkbox column would have to appear
// and disappear with the checkbox, and a row still animating one out against a list that has
// already dropped the column has nowhere to put its content but a second line
const LIST_COLUMNS =
  'min-[1300px]:grid-cols-[2.5rem_fit-content(24rem)_fit-content(18rem)_minmax(0,1fr)_max-content_max-content]'

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
  isSelecting = false,
  buildRowSelection,
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
  // Opens the rail the checkbox sits in, which the import preview never asks for
  isSelecting?: boolean
  buildRowSelection?: (transactionId: string, isReadOnly: boolean) => TransactionRowSelection
  onEditTransaction: (transaction: Transaction) => void
}) {
  const { formatCurrency } = useMoneyFormatters()

  return (
    <motion.div
      className={`min-[1300px]:grid min-[1300px]:gap-x-3 ${LIST_COLUMNS}`}
      style={{ paddingLeft: TRANSACTION_CHECKBOX_RAIL }}
      initial={false}
      animate={{
        [TRANSACTION_CHECKBOX_RAIL_VARIABLE]: isSelecting ? TRANSACTION_CHECKBOX_RAIL_WIDTH : '0rem',
      }}
      transition={{
        duration: prefersReducedMotion ? 0 : TRANSACTION_CHECKBOX_RAIL_DURATION_S,
        ease: TRANSACTION_LIST_EASE,
      }}
    >
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
              className="sticky z-20 flex items-center justify-between rounded-lg py-2 pr-3 min-[1300px]:col-span-full"
              style={{
                top: stickyTop,
                background: 'var(--app-input-bg)',
                borderBottom: '1px solid var(--app-border)',
                ...REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
                paddingLeft: `calc(0.75rem + ${TRANSACTION_CHECKBOX_RAIL})`,
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
                const readOnlyReason = getTransactionReadOnlyReason(transaction, accountMap, fixedAccount)
                return (
                  <TransactionRow
                    key={transaction.id}
                    selection={buildRowSelection?.(transaction.id, Boolean(readOnlyReason))}
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
    </motion.div>
  )
}
