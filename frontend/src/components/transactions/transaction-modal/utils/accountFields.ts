import {
  TRANSACTION_MODAL_FIELD_IDS,
  TRANSACTION_MODAL_FIXED_CONTROL_IDS,
} from '@/components/transactions/transaction-modal/constants'
import type {
  TransactionDirection,
  TransactionFormFieldErrors,
} from '@/components/transactions/transaction-modal/types'

type TransactionField = keyof TransactionFormFieldErrors

interface AccountPlacement {
  isSymmetricTransfer: boolean
  direction: TransactionDirection
}

/**
 * The order the modal draws its validated fields in, and the control that takes focus for each
 *
 * The two account controls keep their places on the page while the fields trade them, so the
 * control that takes focus for an account field follows the same ordering the fields are drawn in
 */
export function getTransactionFieldLayout(placement: AccountPlacement): {
  order: TransactionField[]
  controlIds: Record<TransactionField, string>
} {
  const [top, second] = orderAccountFields<TransactionField>('account_id', 'counterparty_account_id', placement)
  return {
    order: [top, second, 'merchant_id', 'category_id', 'date', 'currency', 'amount'],
    controlIds: {
      ...TRANSACTION_MODAL_FIXED_CONTROL_IDS,
      [top]: TRANSACTION_MODAL_FIELD_IDS.account,
      [second]: TRANSACTION_MODAL_FIELD_IDS.counterpartyAccount,
    } as Record<TransactionField, string>,
  }
}

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
  { isSymmetricTransfer, direction }: AccountPlacement,
): [T, T] {
  return isSymmetricTransfer && direction === 'credit'
    ? [counterpartyAccountField, recordedAccountField]
    : [recordedAccountField, counterpartyAccountField]
}
