import type { AccountsOverview } from '@/api/accounts'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
} from '@/pages/transactions/components/transaction-modal/types'

/**
 * Reports whether the form is recording a transfer into both accounts at once
 */
export function isSymmetricTransferForm(form: TransactionFormValues): boolean {
  return form.kind === 'transfer' && form.symmetric_transfer
}

/**
 * Validates fields required before a transaction can be sent to the API
 */
export function validateTransactionForm(
  form: TransactionFormValues,
  isAmountLocked = false,
): TransactionFormFieldErrors {
  const errors: TransactionFormFieldErrors = {}
  if (!form.account_id) errors.account_id = 'Select an account'
  if (!form.category_id) errors.category_id = 'Select a category'
  if (!form.merchant_id) errors.merchant_id = 'Select or create a merchant'

  // A locked amount is blank, disabled and left out of the update, so requiring one here would block
  // every other edit to the transaction
  if (!isAmountLocked) {
    if (!form.amount) errors.amount = 'Enter an amount'
    else {
      const amount = Number.parseFloat(form.amount)
      if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than zero'
    }
  }
  if (!form.currency) errors.currency = 'Select a currency'
  if (!form.date) errors.date = 'Select a date'

  // A symmetric transfer needs a second account that differs from the originating one
  if (isSymmetricTransferForm(form)) {
    if (!form.to_account_id) errors.to_account_id = 'Select a receiving account'
    else if (form.to_account_id === form.account_id) errors.to_account_id = 'Choose a different receiving account'
  }
  return errors
}

/**
 * Validates the receiving account against the originating account for a symmetric transfer
 *
 * The two legs share a currency and a group so a single amount, category, and tag set apply to
 * both. It returns the receiving-account error message, or undefined when the pair is valid
 */
export function getSymmetricTransferAccountError(
  fromAccount: AccountsOverview | undefined,
  toAccount: AccountsOverview | undefined,
): string | undefined {
  if (!fromAccount || !toAccount) return undefined
  if (toAccount.currency !== fromAccount.currency) return 'Both accounts must use the same currency'
  if (toAccount.group_id !== fromAccount.group_id) return 'Both accounts must be in the same group'
  return undefined
}
