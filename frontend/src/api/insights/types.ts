import type { FxStatus } from '@/api/shared/fx';

// Backend query parameter selecting what the comparison deltas in a range response are computed against
export type InsightsComparisonPeriod = 'same_length' | 'previous_month' | 'previous_year';

// Relative window units a saved range can step back by, mirrored from the backend schema
export type SavedInsightsRangeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

// How a window is anchored, mirrored from the backend: the current period to date (this), the
// previous complete period(s) (last), or a rolling window of the last N periods ending today (past)
export type SavedInsightsRangeQualifier = 'this' | 'last' | 'past';

export interface InsightsPeriodGlanceResponse {
  income: number;
  expenses: number;
  income_expense_fx_status: FxStatus;
  net_worth_change: number;
  net_worth_change_fx_status: FxStatus;
  top_category_name?: string;
  top_category_share_pct?: number;
  top_category_fx_status: FxStatus;
  biggest_change_name?: string;
  biggest_change_amount?: number;
  biggest_change_pct?: number;
  biggest_change_fx_status: FxStatus;
}

export type InsightsFlowEntry = [string, number];

export interface InsightsFundFlowResponse {
  income_sources: InsightsFlowEntry[];
  expense_categories: InsightsFlowEntry[];
  income_outflows: InsightsFlowEntry[];
  expense_inflows: InsightsFlowEntry[];
  income_source_count: number;
  expense_category_count: number;
  fx_status: FxStatus;
}

export type InsightsBreakdownCategoryKind = 'expense' | 'income';
export type InsightsBreakdownEntry = [string, string, InsightsBreakdownCategoryKind, number];
export type InsightsCategoryTrendEntry = [string, string, number, number, number | null, number];

export interface InsightsIncomeExpenseBreakdownResponse {
  expense: InsightsBreakdownEntry[];
  income: InsightsBreakdownEntry[];
  expense_total: number;
  income_total: number;
  expense_increases: InsightsCategoryTrendEntry[];
  expense_decreases: InsightsCategoryTrendEntry[];
  income_increases: InsightsCategoryTrendEntry[];
  income_decreases: InsightsCategoryTrendEntry[];
  fx_status: FxStatus;
}

export type InsightsCashFlowPoint = [string, string, number, number];

export interface InsightsCashFlowResponse {
  points: InsightsCashFlowPoint[];
  fx_status: FxStatus;
}

export type InsightsNetWorthGroup = [string, string, 'asset' | 'debt'];
export type InsightsNetWorthPoint = [string, string, number[]];

export interface InsightsNetWorthResponse {
  groups: InsightsNetWorthGroup[];
  baseline: number[];
  points: InsightsNetWorthPoint[];
  fx_status: FxStatus;
}

export type InsightsSavingsRateTrendPoint = [string, number, number];

export interface InsightsSavingsRateTrendResponse {
  points: InsightsSavingsRateTrendPoint[];
  fx_status: FxStatus;
}

export type InsightsMerchantDistributionEntry = [string, string, number, number | null, number | null];

export type InsightsMerchantRankingEntry = [string, string, number, number, number | null];

export interface InsightsMerchantsResponse {
  distribution: InsightsMerchantDistributionEntry[];
  ranking: InsightsMerchantRankingEntry[];
  fx_status: FxStatus;
}

export interface SavedInsightsRange {
  id: string;
  name: string;
  // Relative window stored as "last {amount} {unit}", resolved to dates on the client
  amount: number;
  unit: SavedInsightsRangeUnit;
  // How the window is anchored: this (current to date), last (previous complete), past (rolling)
  qualifier: SavedInsightsRangeQualifier;
  created_at: string;
}

export interface SaveInsightsRangePayload {
  name: string;
  amount: number;
  unit: SavedInsightsRangeUnit;
  qualifier: SavedInsightsRangeQualifier;
}
