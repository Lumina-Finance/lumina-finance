import type { FxStatus } from '@/api/shared/fx'
import type { Transaction } from '@/api/transactions'
import type { TransactionDateGroup, TransactionListAccount } from '@/components/transactions/types/transactionList'
import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'

/**
 * Groups already-sorted transactions under browser-local calendar date labels
 */
export function groupTransactionsByDate(transactions: Transaction[]): TransactionDateGroup[] {
  const groups: TransactionDateGroup[] = []
  let currentLabel = ''

  // Transactions arrive sorted by date, so one pass preserves backend ordering without building an intermediate map
  for (const transaction of transactions) {
    // A date the calendar does not have keeps its raw value as the heading, so the transaction
    // still appears in the list with its amount rather than disappearing behind a broken label
    const dt = parseYmd(transaction.dt)
    const label = dt ? formatDate(dt, DATE_FORMATS.longDate) : transaction.dt
    if (label !== currentLabel) {
      groups.push({ dateLabel: label, transactions: [] })
      currentLabel = label
    }
    groups[groups.length - 1].transactions.push(transaction)
  }

  return groups
}

/**
 * Returns a transaction's amount in the currency its list totals in, which is the account's on an
 * account-scoped list and the base currency otherwise, or null when the backend had no exchange rate
 */
function getDisplayAmount(transaction: Transaction, fixedAccount?: TransactionListAccount) {
  return fixedAccount ? transaction.account_amount : transaction.base_currency_amount
}

/**
 * Whether a transaction's amount could not be converted into the currency its list totals in
 */
export function isTransactionAmountUnconverted(transaction: Transaction, fixedAccount?: TransactionListAccount) {
  return getDisplayAmount(transaction, fixedAccount) === null
}

/**
 * Sums the displayed amount for one date group using account currency on account-scoped lists and base currency otherwise
 *
 * An amount with no rate is left out of the sum, which the day's FX status says
 */
export function getTransactionDateGroupTotal(
  transactions: Transaction[],
  fixedAccount?: TransactionListAccount,
) {
  return transactions.reduce((sum, transaction) => sum + (getDisplayAmount(transaction, fixedAccount) ?? 0), 0)
}

/**
 * Returns the FX status of a day's total, naming each currency pair it left out, or null when every
 * amount converted so the day shows no badge
 */
export function getTransactionDateGroupFxStatus(
  transactions: Transaction[],
  currency: string,
  fixedAccount?: TransactionListAccount,
): FxStatus | null {
  const missingCurrencies = new Set(
    transactions
      .filter((transaction) => isTransactionAmountUnconverted(transaction, fixedAccount))
      .map((transaction) => transaction.currency),
  )
  if (missingCurrencies.size === 0) return null
  return {
    state: 'incomplete',
    missing_pairs: Array.from(missingCurrencies, (base) => ({ base, quote: currency })),
  }
}
