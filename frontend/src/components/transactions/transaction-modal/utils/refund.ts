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
  return (
    transaction.amount > 0 &&
    categoryKind !== undefined &&
    categoryKind !== 'transfer' &&
    !transaction.refund_of_transaction_id
  )
}

/**
 * The transactions linked to this one: the expense of a refund, or the refunds of an expense. These
 * are the ones deleting it can take along
 */
export function getLinkedTransactionIds(
  transaction: Pick<Transaction, 'refund_of_transaction_id' | 'refund_transaction_ids'>,
): string[] {
  return [
    ...(transaction.refund_of_transaction_id ? [transaction.refund_of_transaction_id] : []),
    ...transaction.refund_transaction_ids,
  ]
}

type Amounted = Pick<Transaction, 'amount' | 'currency'>

/**
 * How much of an expense is still left to refund: its amount less the refunds in its own currency. A
 * refund in another currency can't be added to it, so it takes nothing off, as on the server
 */
export function getRefundRoom(original: Amounted, refunds: readonly Amounted[]): number {
  const refunded = refunds
    .filter((refund) => refund.currency === original.currency)
    .reduce((total, refund) => total + refund.amount, 0)
  return -original.amount - refunded
}

/**
 * Whether a refund of this amount, in this currency, would pass what is left to refund of an expense
 * in the given currency. The server refuses the same link, so the UI keeps it from being made
 */
export function exceedsRefundRoom(refund: Amounted, originalCurrency: string, room: number): boolean {
  return refund.currency === originalCurrency && refund.amount > room
}

/**
 * The candidates a press could pick now, so the picker never lists one it would have to refuse. An expense
 * is offered the refunds that fit what is left of it after the refunds already picked, and keeps the picked
 * ones listed. A refund is offered the expenses that have room for it. A refund in another currency is not
 * counted against the expense, as on the server
 *
 * @param anchor The transaction the window edits
 * @param candidates What the server says linking would accept
 * @param refundRoom What is left to refund of the anchor, when it is an expense, with the links held in the window
 * @param pickedIds The candidates picked in the picker so far
 */
export function getPickableCandidates(
  anchor: Amounted,
  candidates: readonly Transaction[],
  refundRoom: number | undefined,
  pickedIds: readonly string[],
): Transaction[] {
  if (anchor.amount > 0) {
    return candidates.filter(
      (expense) => !exceedsRefundRoom(anchor, expense.currency, -expense.amount - (expense.refunded_amount ?? 0)),
    )
  }
  const picked = candidates.filter((candidate) => pickedIds.includes(candidate.id))
  const remaining =
    (refundRoom ?? Infinity) -
    picked.reduce((total, candidate) => total + (candidate.currency === anchor.currency ? candidate.amount : 0), 0)
  return candidates.filter(
    (candidate) => pickedIds.includes(candidate.id) || !exceedsRefundRoom(candidate, anchor.currency, remaining),
  )
}

/**
 * The note a refund starts with, naming what it refunds so the two read as a pair in the list
 */
export function buildRefundNote(merchantName: string | null): string {
  return merchantName ? `Refund of ${merchantName}` : 'Refund of an expense'
}
