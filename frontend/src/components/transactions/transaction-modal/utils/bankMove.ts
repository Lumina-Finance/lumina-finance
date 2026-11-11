import type { AccountsOverview } from '@/api/accounts'
import type { BankLink } from '@/api/bank-sync'
import type { Transaction } from '@/api/transactions'

type GetBankMoveRefusalOptions = {
  /** The account the form now records the transaction in */
  accountId: string

  /** The stored transaction an edit starts from, absent when creating */
  transaction?: Pick<Transaction, 'account_id' | 'bank_source'>

  /** The account the stored transaction sits in, named in the message */
  sourceAccount: Pick<AccountsOverview, 'name'> | undefined
  linksByAccount: ReadonlyMap<string, Pick<BankLink, 'provider_name'>>
}

/**
 * Says why a bank-imported transaction can't move to the account the form now names, or null when it
 * can
 *
 * Mirrors the backend's refusal, so the account is refused before a save rather than by it. The bank
 * keeps supplying the account it imported the transaction into for as long as that account stays
 * linked, so the transaction stays there too. A manual transaction, or a bank one whose account has
 * since been unlinked, moves freely. Without the source account's name the check is left to the save.
 * The modal shows the save's refusal like any other
 */
export function getBankMoveRefusal({
  accountId,
  transaction,
  sourceAccount,
  linksByAccount,
}: GetBankMoveRefusalOptions): string | null {
  if (!transaction?.bank_source || accountId === transaction.account_id || !sourceAccount) return null

  const sourceLink = linksByAccount.get(transaction.account_id)
  if (!sourceLink) return null

  return `Transactions from ${sourceLink.provider_name} stay in ${sourceAccount.name} while the account is linked`
}
