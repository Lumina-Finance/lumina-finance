import type { FxStatus } from '@/api/shared/fx';

/**
 * Where the counterparty account of a transfer sits: a tracked account elsewhere in the app, or
 * money that left the tracked accounts entirely
 */
export type TransferCounterpartyScope = 'tracked' | 'outside';

/**
 * Which way a transaction moves money, held as the sign of its amount rather than as a field of its
 * own. Money out is a negative amount and money in a positive one
 */
export type TransactionDirection = 'debit' | 'credit';

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
   * Where the counterparty account of a transfer sits. Both null on anything recorded before the
   * columns existed, and on every non-transfer transaction
   */
  counterparty_account_id: string | null;
  counterparty_account_scope: TransferCounterpartyScope | null;
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

  // Required, unlike on an update, where leaving it out keeps whatever the transaction already has
  merchant_id: string;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];

  /**
   * Where the counterparty account of a transfer sits. Required for a transfer-kind category
   * other than Balance Adjustment, and rejected outright for every other category
   */
  counterparty_account_id?: string | null;
  counterparty_account_scope?: TransferCounterpartyScope | null;
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
  counterparty_account_id?: string | null;
  counterparty_account_scope?: TransferCounterpartyScope | null;
}

/**
 * Where a bulk edit's transfer end sits: a tracked account elsewhere in the app, or money that left
 * the tracked accounts entirely. Distinct from `TransferCounterpartyScope`, which shapes the
 * single-transaction counterparty pair this replaces on the bulk request
 */
export type BulkTransferEnd =
  | { scope: 'tracked'; account_id: string }
  | { scope: 'outside' };

/** Which way a bulk direction change points: a fixed direction, or `reverse` to flip each row's own */
export type BulkDirectionChange = TransactionDirection | 'reverse';

/**
 * Details to set across several transactions.
 *
 * A field left out is left alone on every transaction. `notes` distinguishes absent from null: null
 * clears, absent does not touch. `transfer_from` and `transfer_to` take absent the same way, but
 * refuse an explicit null rather than reading it as a clear, since which row an end lands on as its
 * own account is resolved per row rather than naming one column to blank.
 */
export interface BulkUpdateTransactionsPayload {
  transaction_ids: string[];
  account_id?: string;
  dt?: string;
  category_id?: string;
  merchant_id?: string;
  notes?: string | null;

  /**
   * Attached on top of the tags each transaction already carries, unlike `tag_ids` on a single
   * update, which replaces the whole list
   */
  add_tag_ids?: string[];

  /**
   * The transfer's From account. Resolved per row: on a money-out row this is the account the row
   * itself moves into, on a money-in row it is the account recorded as the far side. Valid as a far
   * side only, since a row cannot sit outside the tracked accounts
   */
  transfer_from?: BulkTransferEnd;

  /**
   * The transfer's To account, resolved the opposite way from `transfer_from`: the row's own
   * account on a money-in row, the far side on a money-out row
   */
  transfer_to?: BulkTransferEnd;

  /** Which way every covered transaction should end up pointing, applied as the sign of its amount */
  direction?: BulkDirectionChange;

  /**
   * Which way the covered transactions that resolve to a transfer recording a far side should end
   * up pointing, leaving every other covered row untouched. Never sent alongside direction
   */
  transfer_direction?: BulkDirectionChange;
}

export interface BulkUpdateTransactionsResult {
  transactions_updated: number;

  /** Accounts behind the changed transactions, used to refresh only the views they feed */
  affected_account_ids: string[];
}
