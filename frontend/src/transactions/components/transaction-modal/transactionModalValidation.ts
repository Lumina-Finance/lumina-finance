import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
} from '@/transactions/components/transaction-modal/transactionModalTypes'

/**
 * Validates fields required before a transaction can be sent to the API
 */
export function validateTransactionForm(form: TransactionFormValues): TransactionFormFieldErrors {
  const errors: TransactionFormFieldErrors = {}
  if (!form.account_id) errors.account_id = 'Select an account'
  if (!form.category_id) errors.category_id = 'Select a category'
  if (!form.merchant_id) errors.merchant_id = 'Select or create a merchant'
  if (!form.amount) errors.amount = 'Enter an amount'
  else {
    const amount = Number.parseFloat(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than zero'
  }
  if (!form.currency) errors.currency = 'Select a currency'
  if (!form.date) errors.date = 'Select a date'
  return errors
}
