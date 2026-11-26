import type { AccountsOverview } from '@/api/accounts'
import type { RefundLinkCandidate, Transaction } from '@/api/transactions'
import { getAccountWriteBlockReason } from '@/components/transactions/utils/createBlockReason'

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

export type RefundStatus = 'full' | 'partial'

/** What the badge over an expense's refunds says for each status */
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  full: 'Refunded in full',
  partial: 'Partly refunded',
}

/**
 * How much of an expense its refunds give back, for the badge over its refunds. Null while nothing is refunded
 *
 * @param original The expense
 * @param room What is left to refund of it, from `getRefundRoom`
 */
export function getRefundStatus(original: Amounted, room: number): RefundStatus | null {
  if (room >= -original.amount) return null
  return room <= 0 ? 'full' : 'partial'
}

/**
 * The refunds in a chain in date order, oldest first, so the chain reads as the money came back. The server lists
 * them in the order they were linked, and links made in the window come after them. Until every date is known, the
 * refunds keep the order given. Refunds on one day keep it too
 *
 * @param refunds The refunds, saved, applied and held alike
 * @param dateOf A refund's date, or undefined while it loads
 */
export function orderRefundsByDate<T>(refunds: readonly T[], dateOf: (refund: T) => string | undefined): T[] {
  if (refunds.some((refund) => dateOf(refund) === undefined)) return [...refunds]
  return [...refunds].sort((a, b) => (dateOf(a) as string).localeCompare(dateOf(b) as string))
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
 * The accounts the transaction form's Account dropdown offers. An archived account takes no new transaction,
 * and neither does one the server keeps read-only. A bank item's own account stays, so its review names it
 * while Add to ledger waits, and a refund keeps to the accounts its expense's refund can go to
 *
 * @param accounts Every account the form knows
 * @param reviewAccountId The account of the bank item under review, if any
 * @param refundCurrency The currency of the expense a refund is for, if the form records one
 */
export function getSelectableAccounts<
  T extends Pick<AccountsOverview, 'id' | 'currency' | 'group_id' | 'is_archived' | 'read_only_reason'>,
>(accounts: readonly T[], reviewAccountId?: string, refundCurrency?: string): T[] {
  const writable = accounts.filter(
    (account) => account.id === reviewAccountId || getAccountWriteBlockReason(account) === undefined,
  )
  return refundCurrency === undefined ? writable : getRefundAccounts(writable, refundCurrency)
}

/**
 * The candidates a press can't pick now, with what is left to refund for each, so the picker greys them out and
 * says why. The picker also refuses a press on one, for a row still easing into the folded row. An expense is offered
 * refunds against what is left of it after the refunds already picked, and a picked row is never refused. A refund
 * is offered expenses by their own room
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

export interface LinkCandidateGroups<T> {
  /** Linkable candidates from the same merchant or for exactly what is left, in the server's order */
  likely: T[]

  /** Every other linkable candidate, nearest amount first */
  other: T[]

  /** Candidates a pick can't take now, each with what is left to refund for it */
  unlinkable: { candidate: T; room: number }[]
}

/**
 * Sorts the picker's candidates into the likely matches, the others and those that can't be linked now. The server
 * says why each is likely and puts the likely ones first, so a row keeps its group while picks change. Picks only
 * move rows into and out of the ones that can't be linked
 *
 * @param candidates What the server offers, in its order
 * @param refusedRooms The candidates a pick can't take now, from `getRefusedRooms`
 */
export function groupLinkCandidates<T extends Pick<RefundLinkCandidate, 'id' | 'same_merchant' | 'exact_amount'>>(
  candidates: readonly T[],
  refusedRooms: ReadonlyMap<string, number>,
): LinkCandidateGroups<T> {
  const groups: LinkCandidateGroups<T> = { likely: [], other: [], unlinkable: [] }
  for (const candidate of candidates) {
    const room = refusedRooms.get(candidate.id)
    if (room !== undefined) groups.unlinkable.push({ candidate, room })
    else if (candidate.same_merchant || candidate.exact_amount) groups.likely.push(candidate)
    else groups.other.push(candidate)
  }
  return groups
}

/**
 * Says how many candidates can't be linked and why, when they share a reason, as in "2 can't be linked, each more than
 * what's left". On an expense each refund is held back by what is left of the expense. On a refund each expense is
 * held back by what is left of its own
 *
 * @param picksRefund Whether the picker is an expense's, picking its refunds
 * @param rooms What is left to refund for each candidate that can't be linked
 */
export function describeUnlinkable(picksRefund: boolean, rooms: readonly number[]): string {
  const count = `${rooms.length} can't be linked`
  const each = rooms.length === 1 ? '' : 'each '
  if (rooms.every((room) => room <= 0)) {
    return `${count}, ${picksRefund ? 'nothing is left to refund' : `${each}already refunded in full`}`
  }
  if (rooms.every((room) => room > 0)) {
    return `${count}, ${picksRefund ? `${each}more than what's left` : `${each}with less than this refund left`}`
  }
  return count
}

/**
 * The note a refund starts with, naming what it refunds so the two read as a pair in the list
 */
export function buildRefundNote(merchantName: string | null): string {
  return merchantName ? `Refund of ${merchantName}` : 'Refund of an expense'
}
