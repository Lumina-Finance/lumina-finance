import type { FxStatus } from '@/api/dashboard';
import type { RunwayThresholds } from '@/utils/runway';

/**
 * Editable profile fields for the current user
 */
export interface UpdateProfilePayload {
  first_name?: string;
  last_name?: string | null;
  tz?: string;
}

export interface CacheScopeStatus {
  changed_at: string | null;
  last_change_from_current_session: boolean;
}

export interface CacheStatus {
  changed_at: string | null;
  personal: CacheScopeStatus;
  groups: Record<string, CacheScopeStatus>;
}

export interface RunwayThresholdsResponse {
  risky_below_months: number;
  healthy_at_months: number;
}

export interface RunwaySettingsResponse {
  account_ids: string[];
  archived_account_ids: string[];
  thresholds: RunwayThresholdsResponse;
}

export interface RunwaySettingsPayload {
  account_ids: string[];
  thresholds: RunwayThresholdsResponse;
}

export interface RunwaySettings {
  accountIds: string[];
  archivedAccountIds: string[];
  thresholds: RunwayThresholds;
}

export interface RunwaySettingsUpdate {
  accountIds: string[];
  thresholds: RunwayThresholds;
}

export interface RunwayAccountBalance {
  account_id: string;
  balance: number;
}

export interface RunwayResultResponse {
  months: number | null;
  reason: 'no_accounts' | 'insufficient_history' | null;
  avg_monthly_expense: number;
  months_covered: number;
  liquid_balance: number;
  account_balances: RunwayAccountBalance[];
  thresholds: RunwayThresholdsResponse;
  fx_status: FxStatus;
}

/**
 * Frontend runway result with normalized threshold field names
 */
export interface RunwayResult {
  months: number | null;
  reason: 'no_accounts' | 'insufficient_history' | null;
  avg_monthly_expense: number;
  months_covered: number;
  liquid_balance: number;
  account_balances: RunwayAccountBalance[];
  thresholds: RunwayThresholds;
  fx_status: FxStatus;
}
