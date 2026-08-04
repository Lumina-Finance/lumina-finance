/**
 * Covers how the insights savings-rate trend labels each month, including a stored month key that
 * is not a real date, which the browser would otherwise parse for itself
 */
import { describe, expect, it } from 'vitest';
import type { FxStatus } from '@/api/shared/fx';
import { getSavingsRateHistory } from '@/pages/insights/utils/savingsRateTrend';

const FX_STATUS: FxStatus = { state: 'none', missing_pairs: [] };

describe('getSavingsRateHistory', () => {
  it('labels a month from its calendar parts', () => {
    const [point] = getSavingsRateHistory({ points: [['2026-03-01', 100, 40]], fx_status: FX_STATUS });

    expect(point.monthLabel).toBe('Mar');
    expect(point.fullLabel).toBe('March 2026');
  });

  it('marks the first month of a year with its two-digit year', () => {
    const [point] = getSavingsRateHistory({ points: [['2026-01-01', 100, 40]], fx_status: FX_STATUS });

    expect(point.tickLabel).toBe("Jan '26");
  });

  it('keeps a month the calendar does not have as its own label', () => {
    const [point] = getSavingsRateHistory({ points: [['2026-02-31', 100, 40]], fx_status: FX_STATUS });

    expect(point.monthLabel).toBe('2026-02-31');
    expect(point.tickLabel).toBe('2026-02-31');
    expect(point.fullLabel).toBe('2026-02-31');
  });
});
