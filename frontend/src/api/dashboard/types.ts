import type { AccountType } from '@/api/accounts/types'
import type { Institution } from '@/api/institutions/types'
import type { Transaction } from '@/api/transactions/types'
import type { FxStatus } from '@/api/shared/fx'

export interface MonthlyIncomeExpense {
  // First-of-month calendar date in YYYY-MM-DD format
  month: string
  income: number
  expenses: number
}

export interface CreditWidgetResponse {
  credit_limit_total: number
  credit_used: number
  fx_status: FxStatus
}

export type CreditUtilizationAccount = {
  id: string
  name: string

  // Whether the account's limit and balance are in the totals
  is_counted: boolean

  // What the chooser's rows show beside the name
  account_type: AccountType
  institution: Institution | null
}

// Credit totals for only the accounts counted, in the user's base currency minor units, with every
// credit account the user can choose between. The accounts page totals every account through
// CreditWidgetResponse instead
export type CreditUtilizationResponse = CreditWidgetResponse & {
  accounts: CreditUtilizationAccount[]
}

export interface NetWorthWidgetResponse {
  current_net_worth: number
  net_worth_history: number[]
  net_worth_window_days: number
  fx_status: FxStatus
}

export interface SavingsRateWidgetResponse {
  savings_rate_history: MonthlyIncomeExpense[]
  fx_status: FxStatus
}

export interface RecentActivityWidgetResponse {
  recent_transactions: Transaction[]
  transaction_window_days: number
}

export type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD'
export type BreakdownCategoryKind = 'expense' | 'income'

export interface CategoryBreakdownEntry {
  category_id: string
  name: string
  category_kind: BreakdownCategoryKind
  amount: number
}

export interface SpendingBreakdownResponse {
  range: SpendingRange
  expense: CategoryBreakdownEntry[]
  income: CategoryBreakdownEntry[]
  expense_total: number
  income_total: number
  fx_status: FxStatus
}

export interface SpendingComparisonResponse {
  range: SpendingRange
  // X-axis labels covering the full current period
  slot_labels: string[]
  // Cumulative positive minor-unit totals aligned by index with slot labels
  current: number[]
  previous: number[]
  // How many completed earlier periods the average may draw on: the latest 12 weeks, 12 months, 4 quarters
  // or 3 years, fewer when the history is shorter. Always sent, and includes periods without spending
  average_periods: number
  // Per slot, the sum of the cumulative totals of those periods that have the slot and some spending, and
  // how many periods that is, in minor units. A period without spending is in neither. Sent only when asked
  // for, and empty when no period has spending
  average_sums: number[]
  average_counts: number[]
  fx_status: FxStatus
  // The conversions of the average's periods alone, so a missing old rate flags only the average
  average_fx_status: FxStatus
}
