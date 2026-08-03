import type { TransactionDirection } from '@/pages/transactions/components/transaction-modal/types'

/**
 * Orders the modal's two account fields for display, source first
 *
 * An ordinary transfer is recorded in one account and states which counterparty account the money
 * touched, so the recorded one stays on top and the direction changes the label below it. A paired
 * transfer writes a transaction in both, so its fields read as From and To instead. On a credit the
 * money arrives in the recorded account, which makes the counterparty the source and puts it above.
 *
 * Each field is carried whole rather than field by field, so a field's value, error and option list
 * cannot end up on opposite sides of the form
 */
export function orderAccountFields<T>(
  recordedAccountField: T,
  counterpartyAccountField: T,
  { isSymmetricTransfer, direction }: { isSymmetricTransfer: boolean; direction: TransactionDirection },
): [T, T] {
  return isSymmetricTransfer && direction === 'credit'
    ? [counterpartyAccountField, recordedAccountField]
    : [recordedAccountField, counterpartyAccountField]
}
