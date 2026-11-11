import type { Transaction } from '@/api/transactions'
import type { TransactionBankSource } from '@/api/bank-sync'
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

/** What deciding whether a ticked transaction can be deleted reads of it */
type TickedTransaction = {
  account_id: string
  bank_source: Pick<TransactionBankSource, 'provider_name'> | null
}

/**
 * Returns why the ticked transactions cannot be deleted together, or undefined when they can
 *
 * Lumina builds for individually owned resources, so bulk delete leaves group accounts out here, in
 * one place, the way the server refuses them. A bank-imported transaction stays while its account is
 * linked, as it does when deleted alone, so a selection holding one is refused with the server's
 * reason for a selection, naming the provider and the first such row's account. Without that
 * account's name the check is left to the server, and the confirmation shows its refusal. A row bulk
 * edit cannot change is never ticked, so the other rules single delete follows are already met by
 * the selection itself
 *
 * @param selected - Each ticked transaction, in the order the list shows them
 * @param accountMap - Every account the list knows, by id
 * @param fixedAccount - The account a list fixed to one account shows
 * @param linksByAccount - Each linked account's link, by account id
 */
export function getBulkDeleteBlockReason(
  selected: ReadonlyArray<TickedTransaction>,
  accountMap: Map<string, TransactionListAccount>,
  fixedAccount?: TransactionListAccount,
  linksByAccount: ReadonlyMap<string, unknown> = new Map(),
): string | undefined {
  const accountOf = (accountId: string) => fixedAccount ?? accountMap.get(accountId)
  if (selected.some((row) => accountOf(row.account_id)?.group_id)) return GROUP_ACCOUNT_BULK_DELETE_REASON

  const held = selected.find((row) => row.bank_source && linksByAccount.has(row.account_id))
  const accountName = held && accountOf(held.account_id)?.name
  if (!held?.bank_source || !accountName) return undefined
  return `Transactions from ${held.bank_source.provider_name} can't be deleted while ${accountName} is linked`
}
