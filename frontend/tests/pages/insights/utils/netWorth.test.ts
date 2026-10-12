/**
 * Covers the net worth card labelling its points by the bucket size the backend grouped them into,
 * which once labelled a 91 to 183 day range of weekly points by month
 */
import { describe, expect, it } from 'vitest';
import { getNetWorthCardData } from '@/pages/insights/utils/netWorth';

describe('getNetWorthCardData', () => {
  it('labels the points of a 92-day range by their day', () => {
    const { series } = getNetWorthCardData(
      {
        groups: [['cash', 'Cash', 'asset']],
        baseline: [0],
        points: [['2026-01-05', '2026-01-11', [100]]],
        fx_status: { state: 'none', missing_pairs: [] },
      },
      '2026-01-05',
      '2026-04-06',
    );

    expect(series[0].dateLabel).toBe('Jan 5');
  });
});
