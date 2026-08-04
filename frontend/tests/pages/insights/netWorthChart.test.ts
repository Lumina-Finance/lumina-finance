/**
 * Covers how the net worth chart turns each point's date into the position it is plotted at, which
 * is the one reader with no label to fall back to when the date is not a real one
 */
import { describe, expect, it } from 'vitest';
import {
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
