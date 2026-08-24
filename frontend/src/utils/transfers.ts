import type { Category } from '@/api/categories'

// The backend tags synthetic balance adjustments with this system transfer category name and
// excludes them from cash flow
export const BALANCE_ADJUSTMENT_CATEGORY_NAME = 'Balance Adjustment'

// The system expense category a repayment is most often filed under. Correct for a loan or a
// mortgage, and a double count for a credit account, whose purchases were expensed when they were made
export const DEBT_PAYMENT_CATEGORY_NAME = 'Debt Payment'

// The system transfer category that records a credit account repayment without expensing it again
export const CREDIT_CARD_PAYMENT_CATEGORY_NAME = 'Credit Card Payment'

// Sentinel dropdown value for money that left the tracked accounts, distinct from any real account
// id, and the one label every dropdown offering that answer uses
export const OUTSIDE_ACCOUNT_VALUE = '__outside__'
export const OUTSIDE_ACCOUNT_LABEL = 'Outside this app'

/**
 * Reports whether a transfer in the given kind and category records which counterparty account
 * the money touched
 *
 * True for every transfer-kind category except Balance Adjustment, which has no counterparty.
 * Mirrors the backend's does_category_record_counterparty_account, which matches the name alone
 */
export function doesTransferRecordCounterpartyAccount(
  kind: Category['kind'],
  isBalanceAdjustmentCategory: boolean,
): boolean {
  return kind === 'transfer' && !isBalanceAdjustmentCategory
}
