import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import {
  INITIAL_TRANSACTION_FORM,
  OUTSIDE_ACCOUNT_VALUE,
} from '@/pages/transactions/components/transaction-modal/constants'
import { amountToInputString } from '@/pages/transactions/components/transaction-modal/utils/money'
import { findCurrencyExponent } from '@/utils/moneyInput'
import type {
  TransactionFormValues,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'
import { getTodayYmd } from '@/utils/date'

interface BuildInitialTransactionFormOptions {
  transaction?: Transaction
  categories: Category[]
  currencies: Currency[]
  selectableAccounts: AccountsOverview[]
  defaultAccountId?: string
  defaultCurrency?: string
  // Required rather than optional so a call site has to name the zone it means, since an omitted
  // one falls back to the browser's calendar and dates a new transaction on the wrong day for
  // anyone away from the region their profile names
  timeZone: string | undefined
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
  timeZone,
}: BuildInitialTransactionFormOptions): TransactionFormValues {
  if (!transaction) {
    const defaultAccount = defaultAccountId
      ? selectableAccounts.find((account) => account.id === defaultAccountId)
      : undefined
    return {
      ...INITIAL_TRANSACTION_FORM,
      account_id: defaultAccount?.id ?? INITIAL_TRANSACTION_FORM.account_id,
      currency: defaultAccount?.currency ?? defaultCurrency ?? INITIAL_TRANSACTION_FORM.currency,
      date: getTodayYmd(timeZone),
    }
  }

  const category = categories.find((item) => item.id === transaction.category_id)
  // Left blank rather than scaled by an assumed two decimal places, since the stored amount can only be
  // turned into text through the real ones
  const exponent = findCurrencyExponent(currencies, transaction.currency)

  return {
    kind: (category?.kind as TransactionModalKind) ?? 'expense',
    direction: transaction.amount >= 0 ? 'credit' : 'debit',
    account_id: transaction.account_id,
    category_id: transaction.category_id,
    merchant_id: transaction.merchant_id ?? '',
    amount: exponent === null ? '' : amountToInputString(transaction.amount, exponent),
    currency: transaction.currency,
    notes: transaction.notes ?? '',
    date: transaction.dt,
    tag_ids: transaction.tags?.map((tag) => tag.id) ?? transaction.tag_ids,
    symmetric_transfer: false,
    other_account_id: transaction.other_account_scope === 'outside'
      ? OUTSIDE_ACCOUNT_VALUE
      : transaction.other_account_id ?? '',
  }
}
