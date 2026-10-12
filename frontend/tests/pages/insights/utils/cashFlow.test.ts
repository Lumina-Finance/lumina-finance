/**
 * Covers the cash flow card labelling weekly bars by the month each week starts in, with the week's
 * own dates in the tooltip range
 */
import { describe, expect, it } from 'vitest';
import { getCashFlowBarData } from '@/pages/insights/utils/cashFlow';

describe('getCashFlowBarData', () => {
  it('labels the weekly bars of a 92-day range by month and gives each week its dates', () => {
    const { granularity, buckets } = getCashFlowBarData(
      { points: [['2026-01-05', '2026-01-11', 100, 50]], fx_status: { state: 'none', missing_pairs: [] } },
      '2026-01-05',
      '2026-04-06',
    );

    expect(granularity).toBe('week');
    expect(buckets[0].label).toBe('Jan');
    expect(buckets[0].rangeLabel).toBe('Jan 5-Jan 11');
  });
});
