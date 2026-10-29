import type { Transaction } from '@/api/transactions'

/**
 * Whether a transaction can be refunded: money that left, in a category the app counts as an expense.
 * The server refuses anything else, so the Refund button is offered only where it would be accepted
 */
export function isRefundable(transaction: Transaction, categoryKind: string | undefined): boolean {
  return transaction.amount < 0 && categoryKind === 'expense'
}

/**
 * Whether a transaction can be linked to an expense as its refund: money that came in, outside a
 * transfer, that is not the refund of anything yet. The server refuses anything else
 */
export function canLinkAsRefund(
  transaction: Pick<Transaction, 'amount' | 'refund_of_transaction_id'>,
  categoryKind: string | undefined,
): boolean {
  return transaction.amount > 0 && categoryKind !== undefined && categoryKind !== 'transfer' && !transaction.refund_of_transaction_id
}

/**
 * The transactions linked to this one: the expense of a refund, or the refunds of an expense. These
 * are the ones deleting it can take along
 */
export function getLinkedTransactionIds(
  transaction: Pick<Transaction, 'refund_of_transaction_id' | 'refund_transaction_ids'>,
): string[] {
  return [...(transaction.refund_of_transaction_id ? [transaction.refund_of_transaction_id] : []), ...transaction.refund_transaction_ids]
}

/**
 * The note a refund starts with, naming what it refunds so the two read as a pair in the list
 */
export function buildRefundNote(merchantName: string | null): string {
  return merchantName ? `Refund of ${merchantName}` : 'Refund of an expense'
}
