import type { FxStatus } from '@/api/shared/fx';

/**
 * Where the other side of a transfer sits: a tracked account elsewhere in the app, or money
 * that left the tracked accounts entirely
 */
export type TransferOtherAccountScope = 'tracked' | 'outside';

export interface Transaction {
  id: string;
  created_by_user_id: string;
  account_id: string;

  /**
   * Calendar date in YYYY-MM-DD form with no time zone
   */
  dt: string;
  merchant_id: string | null;
  merchant_name: string | null;
  category_id: string;
  amount: number;
  account_amount: number | null;
  base_currency_amount: number | null;
  currency: string;
  fx_rate: number | null;
  notes: string | null;

  /**
   * Where the other side of a transfer sits. Both null on anything recorded before the columns
   * existed, and on every non-transfer transaction
   */
  other_account_id: string | null;
  other_account_scope: TransferOtherAccountScope | null;
  created_at: string;
  updated_at: string;
  tag_ids: string[];
  tags: TransactionTag[];
}

export interface TransactionTag {
  id: string;
  group_id: string | null;
  name: string;
}

export interface TopCategorySpend {
  category_id: string;
  category_name: string;
  total: number;
}

export interface DailyCashFlow {
  date: string;
  end_date: string;
  inflow: number;
  outflow: number;
}

export interface OutlierTransaction {
  id: string;
  merchant_name: string | null;
  notes: string | null;
  amount: number;
  currency: string;
  dt: string;
}

export interface TransactionsOverview {
  total_inflow: number | null;
  total_outflow: number | null;
  net_flow_fx_status: FxStatus;
  top_categories: TopCategorySpend[] | null;
  top_categories_fx_status: FxStatus;
  daily_cash_flow: DailyCashFlow[] | null;
  daily_cash_flow_fx_status: FxStatus;
  outliers: OutlierTransaction[] | null;
  outliers_fx_status: FxStatus;
}

export interface TransactionFilters {
  // Repeated query keys, each matching any of the selected values
  account_id?: string[];
  category_id?: string[];
  merchant_id?: string[];
  tag_id?: string[];
  // ``all`` requires every selected tag, ``any`` requires at least one
  tag_match?: 'all' | 'any';
  currency?: string;
  // Amount bounds in ``amount_currency`` minor units, matched as a magnitude
  min_amount?: number;
  max_amount?: number;
  amount_currency?: string;
  from_date?: string;
  to_date?: string;
  q?: string;
  sort_by?: 'dt' | 'amount' | 'created_at' | 'updated_at';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface OverviewFilters {
  from_date?: string;
  to_date?: string;
  account_id?: string;
}

export interface CreateTransactionPayload {
  account_id: string;

  /**
   * Calendar date in YYYY-MM-DD form
   */
  dt: string;
  category_id: string;
  amount: number;
  currency: string;
  merchant_id?: string | null;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];

  /**
   * Where the other side of a transfer sits. Required for a transfer-kind category other than
   * Balance Adjustment, and rejected outright for every other category
   */
  other_account_id?: string | null;
  other_account_scope?: TransferOtherAccountScope | null;
}

export interface UpdateTransactionPayload {
  account_id?: string;
  dt?: string;
  category_id?: string;
  amount?: number;
  merchant_id?: string | null;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];
  other_account_id?: string | null;
  other_account_scope?: TransferOtherAccountScope | null;
}
