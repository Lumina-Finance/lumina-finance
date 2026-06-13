import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import { INITIAL_TRANSACTION_FORM } from '@/transactions/components/TransactionModal/transactionModalConstants'
import { amountToInputString, getTodayLocalDateInputValue } from '@/transactions/components/TransactionModal/transactionModalMoney'
import type {
  TransactionFormValues,
  TransactionModalKind,
} from '@/transactions/components/TransactionModal/transactionModalTypes'

interface BuildInitialTransactionFormOptions {
  transaction?: Transaction
  categories: Category[]
  currencies: Currency[]
  selectableAccounts: AccountsOverview[]
  defaultAccountId?: string
  defaultCurrency?: string
}

/**
 * Builds create and edit form defaults from the transaction, account, category, and currency state
 */
export function buildInitialTransactionForm({
  transaction,
  categories,
  currencies,
  selectableAccounts,
  defaultAccountId,
  defaultCurrency,
}: BuildInitialTransactionFormOptions): TransactionFormValues {
  if (!transaction) {
    const defaultAccount = defaultAccountId
      ? selectableAccounts.find((account) => account.id === defaultAccountId)
      : undefined
    return {
      ...INITIAL_TRANSACTION_FORM,
      account_id: defaultAccount?.id ?? INITIAL_TRANSACTION_FORM.account_id,
      currency: defaultAccount?.currency ?? defaultCurrency ?? INITIAL_TRANSACTION_FORM.currency,
      date: getTodayLocalDateInputValue(),
    }
  }

  const category = categories.find((item) => item.id === transaction.category_id)
  const exponent = currencies.find((currency) => currency.id === transaction.currency)?.minor_unit_exponent ?? 2

  return {
    kind: (category?.kind as TransactionModalKind) ?? 'expense',
    direction: transaction.amount >= 0 ? 'credit' : 'debit',
    account_id: transaction.account_id,
    category_id: transaction.category_id,
    merchant_id: transaction.merchant_id ?? '',
    amount: amountToInputString(transaction.amount, exponent),
    currency: transaction.currency,
    notes: transaction.notes ?? '',
    date: transaction.dt,
    tag_ids: transaction.tags?.map((tag) => tag.id) ?? transaction.tag_ids,
  }
}
