import type { Transaction } from '@/api/transactions'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

/**
 * Returns why a transaction cannot be edited, or undefined when it can be.
 *
 * One rule decides both the mark the row shows and whether a bulk selection may tick it, so the
 * two cannot disagree about which rows are editable.
 */
export function getTransactionReadOnlyReason(
  transaction: Transaction,
  accountMap: Map<string, TransactionListAccount>,
  fixedAccount?: TransactionListAccount,
): string | undefined {
  const rowAccount = fixedAccount ?? accountMap.get(transaction.account_id)
  return rowAccount?.is_archived ? 'Archived · Read-only' : undefined
}
