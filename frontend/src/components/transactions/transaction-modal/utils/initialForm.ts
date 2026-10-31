import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import { INITIAL_TRANSACTION_FORM } from '@/components/transactions/transaction-modal/constants'
import { amountToInputString } from '@/components/transactions/transaction-modal/utils/money'
import { buildRefundNote } from '@/components/transactions/transaction-modal/utils/refund'
import { findCurrencyExponent } from '@/utils/moneyInput'
import type { TransactionFormValues, TransactionModalKind } from '@/components/transactions/transaction-modal/types'
import { getTodayYmd } from '@/utils/date'

interface BuildInitialTransactionFormOptions {
  transaction?: Transaction

  /** The expense a new transaction refunds. It starts as a copy of the expense pointing the other way */
  refundOf?: Transaction

  /** What is left to refund of that expense once its linked refunds are counted, which the refund starts at */
  refundRoom?: number
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
  refundOf,
  refundRoom,
  categories,
  currencies,
  selectableAccounts,
  defaultAccountId,
  defaultCurrency,
  timeZone,
}: BuildInitialTransactionFormOptions): TransactionFormValues {
  if (!transaction && refundOf) {
    // The money comes back on the day it is entered, so the date is today's rather than the expense's. It starts at
    // what is left to refund, worked out in whole minor units so no cent is lost
    const copy = buildFormFromTransaction(refundOf, categories, currencies)
    const exponent = findCurrencyExponent(currencies, refundOf.currency)
    return {
      ...copy,

      // An expense whose own account is in another currency can't take the refund, so it starts on one that can
      account_id: selectableAccounts.some((account) => account.id === copy.account_id)
        ? copy.account_id
        : (selectableAccounts[0]?.id ?? ''),
      amount:
        refundRoom === undefined || exponent === null
          ? copy.amount
          : amountToInputString(Math.max(refundRoom, 0), exponent),
      direction: 'credit',
      date: getTodayYmd(timeZone),
      notes: buildRefundNote(refundOf.merchant_name),
    }
  }

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

  return buildFormFromTransaction(transaction, categories, currencies)
}

function buildFormFromTransaction(
  transaction: Transaction,
  categories: Category[],
  currencies: Currency[],
): TransactionFormValues {
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
    counterparty_account_id:
      transaction.counterparty_account_scope === 'outside'
        ? OUTSIDE_ACCOUNT_VALUE
        : (transaction.counterparty_account_id ?? ''),
  }
}
