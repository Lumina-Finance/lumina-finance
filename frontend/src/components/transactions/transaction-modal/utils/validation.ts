import type { AccountsOverview } from '@/api/accounts'
import { doesTransferRecordCounterpartyAccount } from '@/utils/transfers'
import { amountInputToMinorUnits } from '@/components/transactions/transaction-modal/utils/money'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
} from '@/components/transactions/transaction-modal/types'

/**
 * Reports whether the form is recording a transfer into both accounts at once
 */
export function isSymmetricTransferForm(form: TransactionFormValues): boolean {
  return form.kind === 'transfer' && form.symmetric_transfer
}

interface ValidateTransactionFormOptions {
  isAmountLocked?: boolean
  isBalanceAdjustmentCategory?: boolean

  /**
   * What is left to refund of the expense a new refund is for, so one that passes it is refused here,
   * as the server would refuse it. Only an amount in the expense's own currency is compared
   */
  refundLimit?: { minor: number; currency: string; exponent: number; message: string }
}

/**
 * Validates fields required before a transaction can be sent to the API
 */
export function validateTransactionForm(
  form: TransactionFormValues,
  options: ValidateTransactionFormOptions = {},
): TransactionFormFieldErrors {
  const { isAmountLocked = false, isBalanceAdjustmentCategory = false, refundLimit } = options
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
      else if (refundLimit && form.currency === refundLimit.currency) {
        const minor = amountInputToMinorUnits(form.amount, refundLimit.exponent)
        if (minor !== null && minor > refundLimit.minor) errors.amount = refundLimit.message
      }
    }
  }
  if (!form.currency) errors.currency = 'Select a currency'
  if (!form.date) errors.date = 'Select a date'

  // The recorded account doubles as the receiving one when the checkbox is ticked, so there is a
  // single account field either way and nothing to keep in agreement
  if (doesTransferRecordCounterpartyAccount(form.kind, isBalanceAdjustmentCategory)) {
    // Editing answers this too, so a transfer recorded before the field existed says where the
    // money went the next time it is touched at all
    if (!form.counterparty_account_id) {
      errors.counterparty_account_id =
        form.direction === 'debit' ? 'Select where the money went' : 'Select where the money came from'
    } else if (form.counterparty_account_id === form.account_id) {
      errors.counterparty_account_id = 'Choose a different account'
    }
  }
  return errors
}

interface TransactionProblemsOptions extends ValidateTransactionFormOptions {
  editing: boolean
  selectedAccount: AccountsOverview | undefined
  selectedCounterpartyAccount: AccountsOverview | undefined
}

/**
 * Everything wrong with the form right now: its required fields, and for a new paired transfer
 * whether the two accounts can hold the same amount
 *
 * Ticking the checkbox creates a real transaction in the recorded account, so that account has to be
 * one the amount is valid in. Both accounts have to be loaded to compare them
 */
export function getTransactionProblems(
  form: TransactionFormValues,
  { editing, selectedAccount, selectedCounterpartyAccount, ...options }: TransactionProblemsOptions,
): TransactionFormFieldErrors {
  const problems = validateTransactionForm(form, options)
  if (!editing && isSymmetricTransferForm(form) && !problems.counterparty_account_id) {
    const accountError = getSymmetricTransferAccountError(selectedAccount, selectedCounterpartyAccount)
    if (accountError) problems.counterparty_account_id = accountError
  }
  return problems
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
