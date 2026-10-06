import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

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
