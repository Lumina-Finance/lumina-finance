import type { Transaction } from '@/api/transactions';
import type { FxStatus } from '@/api/shared/fx';

export interface MonthlyIncomeExpense {
  // First-of-month calendar date in YYYY-MM-DD format
  month: string;
  income: number;
  expenses: number;
}

export interface CreditWidgetResponse {
  credit_limit_total: number;
  credit_used: number;
  fx_status: FxStatus;
}

export interface NetWorthWidgetResponse {
  current_net_worth: number;
  net_worth_history: number[];
  net_worth_window_days: number;
  fx_status: FxStatus;
}

export interface SavingsRateWidgetResponse {
  savings_rate_history: MonthlyIncomeExpense[];
  fx_status: FxStatus;
}

export interface RecentActivityWidgetResponse {
  recent_transactions: Transaction[];
  transaction_window_days: number;
}

export type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD';
export type BreakdownCategoryKind = 'expense' | 'income';

export interface CategoryBreakdownEntry {
  category_id: string;
  name: string;
  category_kind: BreakdownCategoryKind;
  amount: number;
}

export interface SpendingBreakdownResponse {
  range: SpendingRange;
  expense: CategoryBreakdownEntry[];
  income: CategoryBreakdownEntry[];
  expense_total: number;
  income_total: number;
  fx_status: FxStatus;
}

export interface SpendingComparisonResponse {
  range: SpendingRange;
  // X-axis labels covering the full current period
  slot_labels: string[];
  // Cumulative positive minor-unit totals aligned by index with slot labels
  current: number[];
  previous: number[];
  fx_status: FxStatus;
}
