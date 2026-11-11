import type { AccountsOverview } from '@/api/accounts'
import type { Transaction } from '@/api/transactions'

type GetBankDeleteRefusalOptions = {
  /** The stored transaction the modal edits */
  transaction: Pick<Transaction, 'account_id' | 'bank_source'> | undefined

  /** The account the stored transaction sits in, named in the reason */
  sourceAccount: Pick<AccountsOverview, 'name'> | undefined
  linksByAccount: ReadonlyMap<string, unknown>
}

/**
 * Says why a bank-imported transaction can't be deleted, or null when it can
 *
 * Mirrors the backend's refusal word for word, with no full stop at its end like the other reasons
 * beside a greyed-out button, so Delete is greyed out with the reason rather than refused by the
 * server. While its account stays linked, only a bank removal the user approves
 * takes a bank-imported transaction out of the ledger. A manual transaction, or a bank one whose
 * account has since been unlinked, deletes as usual. Without the account's name the check is left to
 * the delete, and the modal shows its refusal like any other
 */
export function getBankDeleteRefusal({
  transaction,
  sourceAccount,
  linksByAccount,
}: GetBankDeleteRefusalOptions): string | null {
  if (!transaction?.bank_source || !sourceAccount || !linksByAccount.has(transaction.account_id)) return null

  return `Imported from ${transaction.bank_source.provider_name}. Please edit this transaction instead while ${sourceAccount.name} is linked`
}
