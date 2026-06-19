/**
 * Covers the relative range resolver that turns a saved "last N units" window into the
 * inclusive from/to dates the insights cards query
 *
 * The system clock is pinned so trailing-window arithmetic and month-end clamping are
 * asserted against known dates
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatResolvedRangeLabel,
  getRelativeRangeInputDates,
  getRelativeRangeLabel,
} from '@/pages/insights/utils/range';

beforeEach(() => {
  vi.useFakeTimers();

  vi.setSystemTime(new Date(2026, 5, 18));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getRelativeRangeInputDates', () => {
  it('resolves trailing day windows ending today', () => {
    expect(getRelativeRangeInputDates(30, 'day')).toEqual({ from: '2026-05-20', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(1, 'day')).toEqual({ from: '2026-06-18', to: '2026-06-18' });
  });

  it('aligns week windows to the Monday that starts the earliest week', () => {
    expect(getRelativeRangeInputDates(1, 'week')).toEqual({ from: '2026-06-15', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(2, 'week')).toEqual({ from: '2026-06-08', to: '2026-06-18' });
  });

  it('aligns month, quarter, and year windows to the start of the earliest whole period', () => {
    expect(getRelativeRangeInputDates(1, 'month')).toEqual({ from: '2026-06-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(6, 'month')).toEqual({ from: '2026-01-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(1, 'quarter')).toEqual({ from: '2026-04-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(1, 'year')).toEqual({ from: '2026-01-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(2, 'year')).toEqual({ from: '2025-01-01', to: '2026-06-18' });
  });

  it('keeps the aligned start fixed for any day within the current period', () => {
    vi.setSystemTime(new Date(2026, 5, 30));

    expect(getRelativeRangeInputDates(6, 'month')).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });
});

describe('getRelativeRangeLabel', () => {
  it('singularizes a one-unit window and pluralizes the rest', () => {
    expect(getRelativeRangeLabel(1, 'month')).toBe('Last 1 month');
    expect(getRelativeRangeLabel(6, 'month')).toBe('Last 6 months');
    expect(getRelativeRangeLabel(7, 'day')).toBe('Last 7 days');
    expect(getRelativeRangeLabel(1, 'quarter')).toBe('Last 1 quarter');
    expect(getRelativeRangeLabel(2, 'year')).toBe('Last 2 years');
  });
});

describe('formatResolvedRangeLabel', () => {
  it('formats a same-year range without the year', () => {
    expect(formatResolvedRangeLabel('2026-01-01', '2026-06-19')).toBe('Jan 1 – Jun 19');
  });

  it('adds the year on each end when the range crosses years', () => {
    expect(formatResolvedRangeLabel('2025-01-01', '2026-06-19')).toBe('Jan 1, 2025 – Jun 19, 2026');
  });
});
