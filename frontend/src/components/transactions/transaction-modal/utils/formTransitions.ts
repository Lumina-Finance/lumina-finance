import { getDefaultDirectionForKind } from '@/components/transactions/transaction-modal/utils/categories'
import type { TransactionFormValues, TransactionModalKind } from '@/components/transactions/transaction-modal/types'

/**
 * Applies a transaction-kind choice while preserving the form fields supplied by its caller
 *
 * @param keepDirection - Keeps the direction rather than taking the new kind's default, for a bank
 * item, since its direction is the bank's record of which way the money went
 */
export function getFormAfterKindChange(
  form: TransactionFormValues,
  nextKind: TransactionModalKind,
  fields: Partial<TransactionFormValues> = {},
  keepDirection = false,
): TransactionFormValues {
  const kindChanged = nextKind !== form.kind
  const hasReplacementCategory = Object.prototype.hasOwnProperty.call(fields, 'category_id')

  return {
    ...form,
    // A non-transfer kind has no counterparty to record, so a pending answer from a previous
    // transfer selection is dropped rather than lingering unseen. The checkbox goes with it,
    // since leaving it set would arm a second transaction on the next transfer without the user
    // ticking it again
    ...(nextKind === 'transfer' ? {} : { counterparty_account_id: '', symmetric_transfer: false }),
    ...(kindChanged && !hasReplacementCategory ? { category_id: '' } : {}),
    ...fields,
    kind: nextKind,
    direction: nextKind === form.kind || keepDirection ? form.direction : getDefaultDirectionForKind(nextKind),
  }
}
