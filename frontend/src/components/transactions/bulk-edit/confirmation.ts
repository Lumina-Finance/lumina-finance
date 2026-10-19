import type { Transaction } from '@/api/transactions'

type ConfirmationTransaction = Pick<
  Transaction,
  | 'id'
  | 'updated_at'
  | 'account_id'
  | 'dt'
  | 'merchant_id'
  | 'category_id'
  | 'amount'
  | 'currency'
  | 'fx_rate'
  | 'notes'
  | 'counterparty_account_id'
  | 'counterparty_account_scope'
  | 'tag_ids'
>

/**
 * Returns a stable signature of the stored values for the selected transactions
 *
 * Missing selected rows remain in the signature so a refetch can invalidate confirmation before
 * the selection state removes them. Display labels and calculated currency amounts stay out because
 * they do not change the transaction being confirmed
 */
export function selectedTransactionsSignature(
  transactions: readonly ConfirmationTransaction[],
  selectedIds: readonly string[],
): string {
  const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]))

  return JSON.stringify(
    [...selectedIds].sort().map((id) => {
      const transaction = transactionsById.get(id)
      if (!transaction) return [id, null]

      return [
        transaction.id,
        transaction.updated_at,
        transaction.account_id,
        transaction.dt,
        transaction.merchant_id,
        transaction.category_id,
        transaction.amount,
        transaction.currency,
        transaction.fx_rate,
        transaction.notes,
        transaction.counterparty_account_id,
        transaction.counterparty_account_scope,
        [...transaction.tag_ids].sort(),
      ]
    }),
  )
}
