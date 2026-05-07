import type { Transaction } from '@/api/transactions'
import type { TransactionDateGroup } from '@/transactions/types/transactionList'
import { parseYmdLocal } from '@/transactions/utils/date'

export function groupTransactionsByDate(transactions: Transaction[]): TransactionDateGroup[] {
  const groups: TransactionDateGroup[] = []
  let currentLabel = ''

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
