/**
 * Covers the cash flow card labelling weekly bars by the day each week starts, with the week's own dates
 * in the tooltip range, and its tooltip naming no bar when none is active
 */
import { describe, expect, it } from 'vitest';
import type { CashFlowBarBucket } from '@/pages/insights/types/cashFlow';
import { getCashFlowBarData, getCashFlowTooltipBucket } from '@/pages/insights/utils/cashFlow';

describe('getCashFlowTooltipBucket', () => {
  const buckets: CashFlowBarBucket[] = ['Jan', 'Feb', 'Mar'].map((label) => ({
    label,
    rangeLabel: label,
    inflow: 100,
    outflow: 50,
    net: 50,
  }));

  // Recharts reports no active bar as a null index, which Number() turned into the first bar, so the
  // tooltip named the first day while the pointer was elsewhere
  it('names no bucket when no bar is active', () => {
    expect(getCashFlowTooltipBucket({ activeTooltipIndex: null }, buckets)).toBeUndefined();
    expect(getCashFlowTooltipBucket({}, buckets)).toBeUndefined();
  });

  it('names the bucket of the active bar, the first one included', () => {
    expect(getCashFlowTooltipBucket({ activeTooltipIndex: 0 }, buckets)).toBe(buckets[0]);
    expect(getCashFlowTooltipBucket({ activeTooltipIndex: '2' }, buckets)).toBe(buckets[2]);
  });
});

describe('getCashFlowBarData', () => {
  it('labels each weekly bar of a 92-day range by the day its week starts, so no two bars share a label', () => {
    const { granularity, buckets } = getCashFlowBarData(
      {
        points: [['2026-01-05', '2026-01-11', 100, 50], ['2026-01-12', '2026-01-18', 100, 50]],
        fx_status: { state: 'none', missing_pairs: [] },
      },
      '2026-01-05',
      '2026-04-06',
    );

    expect(granularity).toBe('week');
    expect(buckets.map((bucket) => bucket.label)).toEqual(['Jan 5', 'Jan 12']);
    expect(buckets[0].rangeLabel).toBe('Jan 5–Jan 11');
  });

  it('labels the monthly bars of a long range by month', () => {
    const { granularity, buckets } = getCashFlowBarData(
      { points: [['2026-01-01', '2026-01-31', 100, 50]], fx_status: { state: 'none', missing_pairs: [] } },
      '2026-01-01',
      '2026-12-31',
    );

    expect(granularity).toBe('month');
    expect(buckets[0].label).toBe('Jan');
  });
});
