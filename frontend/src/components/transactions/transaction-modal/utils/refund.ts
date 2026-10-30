import type { AccountsOverview } from '@/api/accounts'
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

type Amounted = Pick<Transaction, 'amount'>

/**
 * How much of an expense is still left to refund: its amount less its refunds, which the server keeps in its currency
 */
export function getRefundRoom(original: Amounted, refunds: readonly Amounted[]): number {
  return -original.amount - refunds.reduce((total, refund) => total + refund.amount, 0)
}

/**
 * The accounts a refund of an expense can go to: those in the expense's currency, individually owned, since the
 * server refuses any other
 */
export function getRefundAccounts<T extends Pick<AccountsOverview, 'currency' | 'group_id'>>(
  accounts: readonly T[],
  currency: string,
): T[] {
  return accounts.filter((account) => account.currency === currency && account.group_id === null)
}

/**
 * The candidates a press can't pick now, with what is left to refund for each, so the picker greys them out and
 * says why instead of letting a press be refused. An expense is offered refunds against what is left of it after the
 * refunds already picked, and a picked row is never refused. A refund is offered expenses by their own room
 *
 * @param anchor The transaction the window edits
 * @param candidates What the server says linking would accept
 * @param refundRoom What is left to refund of the anchor, when it is an expense, with the links held in the window
 * @param pickedIds The candidates picked in the picker so far
 * @returns The id of each refused candidate and what is left to refund, never below nothing
 */
export function getRefusedRooms(
  anchor: Amounted,
  candidates: readonly Transaction[],
  refundRoom: number | undefined,
  pickedIds: readonly string[],
): Map<string, number> {
  const refused = new Map<string, number>()
  if (anchor.amount > 0) {
    for (const expense of candidates) {
      const room = -expense.amount - (expense.refunded_amount ?? 0)
      if (anchor.amount > room) refused.set(expense.id, Math.max(room, 0))
    }
    return refused
  }
  const pickedTotal = candidates
    .filter((candidate) => pickedIds.includes(candidate.id))
    .reduce((total, candidate) => total + candidate.amount, 0)
  const remaining = (refundRoom ?? Infinity) - pickedTotal
  for (const candidate of candidates) {
    if (!pickedIds.includes(candidate.id) && candidate.amount > remaining) {
      refused.set(candidate.id, Math.max(remaining, 0))
    }
  }
  return refused
}

/**
 * The note a refund starts with, naming what it refunds so the two read as a pair in the list
 */
export function buildRefundNote(merchantName: string | null): string {
  return merchantName ? `Refund of ${merchantName}` : 'Refund of an expense'
}
