import type { Transaction } from '@/api/transactions'
import type { TransactionDateGroup, TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { parseYmdLocal } from '@/pages/transactions/utils/date'

/**
 * Groups already-sorted transactions under browser-local calendar date labels
 */
export function groupTransactionsByDate(transactions: Transaction[]): TransactionDateGroup[] {
  const groups: TransactionDateGroup[] = []
  let currentLabel = ''

  // Transactions arrive sorted by date, so one pass preserves backend ordering without building an intermediate map
  for (const transaction of transactions) {
    const label = parseYmdLocal(transaction.dt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (label !== currentLabel) {
      groups.push({ dateLabel: label, transactions: [] })
      currentLabel = label
    }
    groups[groups.length - 1].transactions.push(transaction)
  }

  return groups
}

/**
 * Sums the displayed amount for one date group using account currency on account-scoped lists and base currency otherwise
 */
export function getTransactionDateGroupTotal(
  transactions: Transaction[],
  fixedAccount?: TransactionListAccount,
) {
  return transactions.reduce((sum, transaction) => {
    const displayAmount = fixedAccount ? transaction.account_amount : transaction.base_currency_amount
    return sum + (displayAmount ?? 0)
  }, 0)
}
