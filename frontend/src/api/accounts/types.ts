import type { FxStatus } from '@/api/shared/fx';
import type { Institution } from '@/api/institutions/types';

/**
 * Splits liabilities into revolving balances and amortizing debt because cash-flow treatment differs
 */
export type AccountKind = 'asset' | 'revolving' | 'amortizing';

export type AccountType =
  | 'checking'
  | 'savings'
  | 'term_deposit'
  | 'cash'
  | 'investment'
  | 'credit_card'
  | 'line_of_credit'
  | 'heloc'
  | 'loan'
  | 'mortgage';

/**
 * Mirrors backend AccountsOverview for account lists and selectors
 */
export interface AccountsOverview {
  id: string;
  owner_id: string | null;
  group_id: string | null;
  account_kind: AccountKind;
  account_type: AccountType;
  tax_advantaged_category_id: string | null;
  name: string;
  institution: Institution | null;
  currency: string;

  /**
   * Current balance in currency minor units
   */
  current_balance: number;
  base_currency_current_balance: number | null;
  current_balance_fx_status: FxStatus;

  /**
   * Credit limit in currency minor units when the account is revolving credit
   */
  credit_limit: number | null;
  is_archived: boolean;
  closed_at: string | null;
}

/**
 * Mirrors the backend account-kind mapping so forms do not expose a separate kind selector
 */
export const ACCOUNT_KIND_BY_TYPE: Record<AccountType, AccountKind> = {
  checking: 'asset',
  savings: 'asset',
  term_deposit: 'asset',
  cash: 'asset',
  investment: 'asset',
  credit_card: 'revolving',
  line_of_credit: 'revolving',
  heloc: 'revolving',
  loan: 'amortizing',
  mortgage: 'amortizing',
};

/**
 * End-of-day balance record maintained by the backend only for days with activity
 */
export interface AccountBalanceSnapshot {
  account_id: string;
  balance: number;

  /**
   * ISO date in YYYY-MM-DD form
   */
  dt: string;
}

/**
 * Full account shape returned by account detail, create, and update endpoints
 */
export interface Account extends AccountsOverview {
  created_at: string;
}

export interface CreateAccountPayload {
  account_kind: AccountKind;
  account_type: AccountType;
  tax_advantaged_category_id: string | null;
  name: string;
  institution_id: string | null;
  currency: string;
  credit_limit: number | null;
  starting_balance: number | null;
  is_archived: boolean;
}

export interface UpdateAccountPayload {
  tax_advantaged_category_id?: string | null;
  name?: string;
  institution_id?: string | null;
  credit_limit?: number | null;
  is_archived?: boolean;
  closed_at?: string | null;
}

export type SnapshotGranularity = 'day' | 'week' | 'month' | 'quarter';

export interface AccountSnapshotRange {
  fromDate?: string;
  toDate?: string;
  granularity?: SnapshotGranularity;
  includeAnchor?: boolean;
}

/**
 * Calendar period for the backend-defined account spending window
 */
export type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD';

export interface AccountTopCategory {
  category_id: string;
  name: string;
  total: number;
}

export interface AccountTopMerchant {
  merchant_id: string;
  name: string;
  total: number;
}

/**
 * Top category and merchant spend for a single account over a calendar range
 */
export interface AccountSpendingBreakdown {
  range: SpendingRange;
  top_categories: AccountTopCategory[];
  top_merchants: AccountTopMerchant[];
  grand_total_spend: number;
  other_categories_count: number;
  other_merchants_count: number;
}

/**
 * Monthly income and expense totals for one account
 */
export interface AccountMonthlyCashFlow {
  month: string;
  income: number;
  expenses: number;
}
