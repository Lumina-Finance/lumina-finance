import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

/**
 * Returns why a transaction cannot be edited, or undefined when it can be.
 *
 * One rule decides both the mark the row shows and whether a bulk selection may tick it, so the
 * two cannot disagree about which rows are editable. A category missing from the map is one the
 * current user cannot open, since the list only ever loads the categories open to them, and a
 * bulk edit sent over such a row is refused whole regardless of what else it touches.
 */
export function getTransactionReadOnlyReason(
  transaction: Transaction,
  accountMap: Map<string, TransactionListAccount>,
  categoryMap: Map<string, Category>,
  fixedAccount?: TransactionListAccount,
): string | undefined {
  const rowAccount = fixedAccount ?? accountMap.get(transaction.account_id)
  if (rowAccount?.is_archived) return 'Archived · Read-only'
  if (rowAccount?.can_write !== true) return 'Read-only access'
  if (!categoryMap.has(transaction.category_id)) return 'Uses a category you cannot open'
  return undefined
}
