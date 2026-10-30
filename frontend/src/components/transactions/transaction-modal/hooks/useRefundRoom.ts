import { useTransactionsById, type Transaction } from '@/api/transactions'
import type { PendingLinks } from '@/components/transactions/transaction-modal/hooks/usePendingLinks'
import { getRefundRoom } from '@/components/transactions/transaction-modal/utils/refund'

/**
 * Works out how much of the edited expense is still left to refund, counting its saved refunds, the
 * ones the window will link and create on Save, and not the ones it will unlink or already has unlinked. Undefined for anything
 * that isn't an expense, and while a saved refund that counts is still loading
 *
 * @param transaction The transaction the window edits
 * @param pending The link changes the window holds until Save
 */
export function useRefundRoom(transaction: Transaction | undefined, pending: PendingLinks): number | undefined {
  const loaded = useTransactionsById(transaction?.refund_transaction_ids ?? [])
  if (!transaction || transaction.amount >= 0) return undefined
  const isUnlinked = (id: string) => pending.unlinkedRefundIds.includes(id) || pending.appliedUnlinkIds.includes(id)
  const saved = loaded.filter((refund): refund is Transaction => refund !== undefined && !isUnlinked(refund.id))

  // Not known until every refund that counts has loaded, as an amount worked out from some of them would be too big
  const counted = transaction.refund_transaction_ids.filter((id) => !isUnlinked(id))
  if (saved.length < counted.length) return undefined
  const held = [...pending.links, ...pending.refunds.map((refund) => refund.preview)]
  return getRefundRoom(transaction, [...saved, ...held])
}
