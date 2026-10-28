/**
 * Covers the cash flow card labelling weekly bars by the day each week starts, with the week's own dates
 * in the tooltip range, naming the year on the January label and in the tooltips of a range that crosses a
 * calendar year, and its tooltip naming no bar when none is active
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FxStatus } from '@/api/shared/fx';
import { DEFAULT_DATE_FORMAT, setDateFormat, type DateFormatSetting } from '@/utils/dateFormat';
import type { CashFlowBarBucket } from '@/pages/insights/types/cashFlow';
import { getCashFlowBarData, getCashFlowTooltipBucket } from '@/pages/insights/utils/cashFlow';

describe('getCashFlowTooltipBucket', () => {
  const buckets: CashFlowBarBucket[] = ['Jan', 'Feb', 'Mar'].map((label) => ({
    label,
    rangeLabel: label,
    marksYear: false,
    inflow: 100,
    outflow: 50,
    net: 50,
  }));

  // Two Mars of different years read the same on the axis, so the chart's category is the unique range
  it('finds the bucket of the active range when two buckets read the same on the axis', () => {
    const marches: CashFlowBarBucket[] = ['Mar 1 – 31, 2025', 'Mar 1 – 31, 2026'].map((rangeLabel) => ({
      label: 'Mar',
      rangeLabel,
      marksYear: false,
      inflow: 100,
      outflow: 50,
      net: 50,
    }));

    expect(getCashFlowTooltipBucket({ activeLabel: 'Mar 1 – 31, 2026' }, marches)).toBe(marches[1]);
  });

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
    expect(buckets[0].rangeLabel).toBe('Jan 5 – 11');
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

  const fxStatus: FxStatus = { state: 'none', missing_pairs: [] };

  // March 2025 and March 2026 both read "Mar", so only the January label marks where the year turns
  it('labels a long range by month with the year on each January, whose bars are marked', () => {
    const { granularity, buckets } = getCashFlowBarData(
      {
        points: [
          ['2025-01-01', '2025-01-31', 100, 50],
          ['2025-03-01', '2025-03-31', 100, 50],
          ['2026-01-01', '2026-01-31', 100, 50],
          ['2026-03-01', '2026-03-31', 100, 50],
        ],
        fx_status: fxStatus,
      },
      '2025-01-01',
      '2026-03-31',
    );

    expect(granularity).toBe('month');
    expect(buckets.map((bucket) => bucket.label)).toEqual(['Jan 2025', 'Mar', 'Jan 2026', 'Mar']);
    expect(buckets.map((bucket) => bucket.marksYear)).toEqual([true, false, true, false]);
    expect(buckets[3].rangeLabel).toBe('Mar 1 – 31, 2026');
    // The two March bars read the same on the axis, so the tooltip lookup tells them apart by range
    expect(new Set(buckets.map((bucket) => bucket.rangeLabel)).size).toBe(4);
  });

  it('puts the year on the January label when exactly 12 months cross a year boundary', () => {
    const { buckets } = getCashFlowBarData(
      { points: [['2025-12-01', '2025-12-31', 100, 50], ['2026-01-01', '2026-01-31', 100, 50]], fx_status: fxStatus },
      '2025-03-01',
      '2026-02-28',
    );

    expect(buckets.map((bucket) => bucket.label)).toEqual(['Dec', 'Jan 2026']);
  });

  it('puts the year on the first weekly bar of a new year and on the tooltip ranges', () => {
    const { granularity, buckets } = getCashFlowBarData(
      { points: [['2025-12-29', '2026-01-04', 100, 50], ['2026-01-05', '2026-01-11', 100, 50]], fx_status: fxStatus },
      '2025-12-15',
      '2026-02-15',
    );

    expect(granularity).toBe('week');
    expect(buckets.map((bucket) => bucket.label)).toEqual(['Dec 29', 'Jan 5, 2026']);
    expect(buckets[0].rangeLabel).toBe('Dec 29, 2025 – Jan 4, 2026');
  });

  describe('in each date format', () => {
    afterEach(() => {
      setDateFormat(DEFAULT_DATE_FORMAT);
    });

    it.each([
      { format: 'day-month-year', label: '5 Jan', rangeLabel: '5 Jan – 11 Jan' },
      { format: 'iso', label: '01-05', rangeLabel: '01-05 – 01-11' },
    ] satisfies { format: DateFormatSetting; label: string; rangeLabel: string }[])(
      'writes the weekly bars in $format',
      ({ format, label, rangeLabel }) => {
        setDateFormat(format);

        const { buckets } = getCashFlowBarData(
          { points: [['2026-01-05', '2026-01-11', 100, 50]], fx_status: { state: 'none', missing_pairs: [] } },
          '2026-01-05',
          '2026-04-06',
        );

        expect(buckets[0].label).toBe(label);
        expect(buckets[0].rangeLabel).toBe(rangeLabel);
      },
    );
  });
});
