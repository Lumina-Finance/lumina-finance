import type {
  RunwayResult,
  RunwayResultResponse,
  RunwaySettings,
  RunwaySettingsPayload,
  RunwaySettingsResponse,
  RunwaySettingsUpdate,
  RunwayThresholds,
  RunwayThresholdsResponse,
} from '@/api/user/types';
import { normalizeRunwayThresholds } from '@/utils/runway';

/**
 * Converts backend runway thresholds into frontend threshold state
 */
function fromRunwayThresholdsResponse(thresholds: RunwayThresholdsResponse): RunwayThresholds {
  return normalizeRunwayThresholds({
    riskyBelowMonths: thresholds.risky_below_months,
    healthyAtMonths: thresholds.healthy_at_months,
  });
}

/**
 * Converts frontend runway thresholds into the backend payload shape
 */
function toRunwayThresholdsPayload(thresholds: RunwayThresholds): RunwayThresholdsResponse {
  const safeThresholds = normalizeRunwayThresholds(thresholds);
  return {
    risky_below_months: safeThresholds.riskyBelowMonths,
    healthy_at_months: safeThresholds.healthyAtMonths,
  };
}

/**
 * Converts backend runway settings into frontend settings state
 */
export function fromRunwaySettingsResponse(settings: RunwaySettingsResponse): RunwaySettings {
  return {
    accountIds: settings.account_ids,
    archivedAccountIds: settings.archived_account_ids,
    thresholds: fromRunwayThresholdsResponse(settings.thresholds),
  };
}

/**
 * Converts frontend runway settings into the backend payload shape
 */
export function toRunwaySettingsPayload(settings: RunwaySettingsUpdate): RunwaySettingsPayload {
  return {
    account_ids: settings.accountIds,
    thresholds: toRunwayThresholdsPayload(settings.thresholds),
  };
}

/**
 * Converts backend runway results into frontend result state
 */
export function fromRunwayResultResponse(result: RunwayResultResponse): RunwayResult {
  return {
    ...result,
    thresholds: fromRunwayThresholdsResponse(result.thresholds),
  };
}
