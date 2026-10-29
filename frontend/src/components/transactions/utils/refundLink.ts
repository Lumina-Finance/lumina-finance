import type { Transaction } from '@/api/transactions'

/**
 * Says how a transaction is linked, for the icon on its list row. Null when it has no link. A refund
 * that was itself refunded after an edit names both sides
 */
export function getRefundLinkLabel(
  transaction: Partial<Pick<Transaction, 'refund_of_transaction_id' | 'refund_transaction_ids'>>,
): string | null {
  const refundCount = transaction.refund_transaction_ids?.length ?? 0
  const isRefund = Boolean(transaction.refund_of_transaction_id)
  if (!isRefund && refundCount === 0) return null

  const parts: string[] = []
  if (isRefund) parts.push('Refund of an expense')
  if (refundCount > 0) parts.push(refundCount === 1 ? 'Refunded once' : `Refunded ${refundCount} times`)
  return parts.join(', ')
}
