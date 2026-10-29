import type { Transaction } from '@/api/transactions'

/**
 * Whether a transaction can be refunded: money that left, in a category the app counts as an expense.
 * The server refuses anything else, so the Refund button is offered only where it would be accepted
 */
export function isRefundable(transaction: Transaction, categoryKind: string | undefined): boolean {
  return transaction.amount < 0 && categoryKind === 'expense'
}

/**
 * What deleting a transaction also removes, said when delete is armed. Empty when it has no refund link
 */
export function buildDeleteLinkNotice(
  transaction: Pick<Transaction, 'refund_of_transaction_id' | 'refund_transaction_ids'>,
): string {
  const linkCount = (transaction.refund_of_transaction_id ? 1 : 0) + transaction.refund_transaction_ids.length
  if (linkCount === 0) return ''
  return linkCount === 1 ? 'This also removes its refund link.' : `This also removes its ${linkCount} refund links.`
}

/**
 * The note a refund starts with, naming what it refunds so the two read as a pair in the list
 */
export function buildRefundNote(merchantName: string | null): string {
  return merchantName ? `Refund of ${merchantName}` : 'Refund of an expense'
}
