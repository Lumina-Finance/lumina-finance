import type { FxStatus } from '@/api/shared/fx';

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
  account_id?: string;
  category_id?: string;
  merchant_id?: string;
  currency?: string;
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
}
