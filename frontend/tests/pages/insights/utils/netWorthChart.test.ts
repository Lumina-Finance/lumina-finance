/**
 * Covers how the net worth chart turns each point's date into the position it is plotted at, which
 * is the one reader with no label to fall back to when the date is not a real one, and how its axis
 * writes an amount, whole on both sides of the first threshold
 */
import { describe, expect, it } from 'vitest';
import {
  formatNetWorthAxisMoney,
  getNetWorthChartData,
  getNetWorthChartItems,
  type NetWorthPoint,
} from '@/pages/insights/utils/netWorthChart';

const GROUPS = [{ id: 'cash', name: 'Cash', kind: 'asset' as const }];

/**
 * Builds a one-group series point carrying the supplied date
 */
function createPoint(date: string): NetWorthPoint {
  return { date, dateLabel: date, tooltipLabel: date, total: 100, values: [100] };
}

describe('net worth chart positions', () => {
  it('plots a point at the UTC midnight of its calendar day', () => {
    const items = getNetWorthChartItems(GROUPS, 'overview');

    const [point] = getNetWorthChartData([createPoint('2026-03-09')], items, 'overview');

    expect(point.dateMs).toBe(Date.UTC(2026, 2, 9));
  });

  it('refuses a date the calendar does not have rather than plotting it in the next month', () => {
    const items = getNetWorthChartItems(GROUPS, 'overview');

    expect(() => getNetWorthChartData([createPoint('2026-02-31')], items, 'overview')).toThrow('2026-02-31');
  });

  it('refuses a date the browser would parse for itself', () => {
    const items = getNetWorthChartItems(GROUPS, 'overview');

    expect(() => getNetWorthChartData([createPoint('March 9, 2026')], items, 'overview')).toThrow();
  });
});

describe('net worth axis money', () => {
  const currencies = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }];

  it('writes ticks whole on both sides of the first threshold, to the nearest and without a decimal', () => {
    // An axis tick is a round step, so it is exempt from the rounding rule and reads 3K, not 3.0K
    expect(formatNetWorthAxisMoney(50_000, 'CAD', currencies)).toBe('CA$500');
    expect(formatNetWorthAxisMoney(99_999, 'CAD', currencies)).toBe('CA$1K');
    expect(formatNetWorthAxisMoney(300_000, 'CAD', currencies)).toBe('CA$3K');
  });
});
