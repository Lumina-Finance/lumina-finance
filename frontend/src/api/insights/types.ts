import type { FxStatus } from '@/api/shared/fx';

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
