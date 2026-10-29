import type { Transaction } from '@/api/transactions'

export interface RefundLinkLabel {
  /** The word the row shows beside its tags */
  short: 'Refund' | 'Refunded'

  /** The whole sentence for assistive technology, and for the icon where the word has no room */
  full: string
}

/**
 * Says how a transaction is linked, for its list row: a refund reads "Refund" and the expense it
 * refunds reads "Refunded". Null when it has no link. A refund that was itself refunded after an edit
 * reads as the refund it is, with both sides in the full sentence
 */
export function getRefundLinkLabel(
  transaction: Partial<Pick<Transaction, 'refund_of_transaction_id' | 'refund_transaction_ids'>>,
): RefundLinkLabel | null {
  const refundCount = transaction.refund_transaction_ids?.length ?? 0
  const isRefund = Boolean(transaction.refund_of_transaction_id)
  if (!isRefund && refundCount === 0) return null

  const parts: string[] = []
  if (isRefund) parts.push('Refund of an expense')
  if (refundCount > 0) parts.push(refundCount === 1 ? 'Refunded once' : `Refunded ${refundCount} times`)
  return { short: isRefund ? 'Refund' : 'Refunded', full: parts.join(', ') }
}
