import type { Transaction } from '@/api/transactions'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'

/**
 * Returns the transactions linked to the ones being deleted that are not being deleted themselves.
 * The server removes the links of every deleted transaction, and these are the ones left on the
 * other side, which the user is asked about
 *
 * @param rows - The transactions being deleted, with their refund links
 */
export function getLinkedIdsOutside(
  rows: Pick<Transaction, 'id' | 'refund_of_transaction_id' | 'refund_transaction_ids'>[],
): string[] {
  const deleted = new Set(rows.map((row) => row.id))
  const linked = new Set<string>()
  for (const row of rows) {
    for (const id of [row.refund_of_transaction_id, ...row.refund_transaction_ids]) {
      if (id && !deleted.has(id)) linked.add(id)
    }
  }
  return [...linked]
}

export const GROUP_ACCOUNT_BULK_DELETE_REASON = "Transactions in group accounts can't be deleted in bulk"

/**
 * Returns why the ticked transactions cannot be deleted together, or undefined when they can
 *
 * Lumina builds for individually owned resources, so bulk delete leaves group accounts out here, in
 * one place, the way the server refuses them. A row bulk edit cannot change is never ticked, so the
 * other rules single delete follows are already met by the selection itself
 *
 * @param selectedAccountIds - The account of each ticked transaction
 * @param accountMap - Every account the list knows, by id
 * @param fixedAccount - The account a list fixed to one account shows
 */
export function getBulkDeleteBlockReason(
  selectedAccountIds: string[],
  accountMap: Map<string, TransactionListAccount>,
  fixedAccount?: TransactionListAccount,
): string | undefined {
  const isInGroup = (accountId: string) => Boolean((fixedAccount ?? accountMap.get(accountId))?.group_id)
  return selectedAccountIds.some(isInGroup) ? GROUP_ACCOUNT_BULK_DELETE_REASON : undefined
}
