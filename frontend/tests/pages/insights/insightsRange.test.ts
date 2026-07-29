/**
 * Covers the two resolvers that turn an insights range into the inclusive from/to dates the cards
 * query, one for a saved "last N units" window and one for a fixed preset
 *
 * The system clock is pinned so trailing-window arithmetic and month-end clamping are
 * asserted against known dates
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatResolvedRangeLabel,
  getRangeInputDates,
  getRelativeRangeInputDates,
  getRelativeRangeLabel,
} from '@/pages/insights/utils/range';

// Late evening in Toronto on 30 June, already 1 July in UTC, so a zone mix-up shows up as a
// different day and a different month
const LATE_JUNE_EVENING = new Date('2026-07-01T02:00:00Z');

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

  it('resolves last-qualifier windows as whole finished periods ending before the current one', () => {
    expect(getRelativeRangeInputDates(1, 'month', 'last')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(getRelativeRangeInputDates(1, 'quarter', 'last')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(getRelativeRangeInputDates(2, 'quarter', 'last')).toEqual({ from: '2025-10-01', to: '2026-03-31' });
    expect(getRelativeRangeInputDates(1, 'year', 'last')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(getRelativeRangeInputDates(1, 'week', 'last')).toEqual({ from: '2026-06-08', to: '2026-06-14' });
  });

  it('resolves this-qualifier windows as the current period up to today', () => {
    expect(getRelativeRangeInputDates(1, 'month', 'this')).toEqual({ from: '2026-06-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(1, 'quarter', 'this')).toEqual({ from: '2026-04-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(1, 'year', 'this')).toEqual({ from: '2026-01-01', to: '2026-06-18' });
    expect(getRelativeRangeInputDates(1, 'week', 'this')).toEqual({ from: '2026-06-15', to: '2026-06-18' });
  });

  it('ends the window on the given zone\'s day rather than the browser calendar', () => {
    vi.setSystemTime(LATE_JUNE_EVENING);

    expect(getRelativeRangeInputDates(1, 'day', 'past', 'America/Toronto')).toEqual({ from: '2026-06-30', to: '2026-06-30' });
    expect(getRelativeRangeInputDates(1, 'day', 'past', 'UTC')).toEqual({ from: '2026-07-01', to: '2026-07-01' });
  });
});

describe('getRangeInputDates', () => {
  it('resolves the presets that name their own window against today', () => {
    expect(getRangeInputDates('THIS_MONTH')).toEqual({ from: '2026-06-01', to: '2026-06-18' });
    expect(getRangeInputDates('LAST_MONTH')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(getRangeInputDates('LAST_30_DAYS')).toEqual({ from: '2026-05-20', to: '2026-06-18' });
    expect(getRangeInputDates('LAST_90_DAYS')).toEqual({ from: '2026-03-21', to: '2026-06-18' });
    expect(getRangeInputDates('THIS_YEAR')).toEqual({ from: '2026-01-01', to: '2026-06-18' });
  });

  it('reads which period is current from the given zone rather than the browser calendar', () => {
    vi.setSystemTime(LATE_JUNE_EVENING);

    expect(getRangeInputDates('THIS_MONTH', 'America/Toronto')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(getRangeInputDates('THIS_MONTH', 'UTC')).toEqual({ from: '2026-07-01', to: '2026-07-01' });
  });
});

describe('getRelativeRangeLabel', () => {
  it('labels the current period without a count', () => {
    expect(getRelativeRangeLabel(1, 'month', 'this')).toBe('This month');
    expect(getRelativeRangeLabel(3, 'quarter', 'this')).toBe('This quarter');
  });

  it('labels a single completed period without a count and pluralizes the rest', () => {
    expect(getRelativeRangeLabel(1, 'quarter', 'last')).toBe('Last quarter');
    expect(getRelativeRangeLabel(1, 'month', 'last')).toBe('Last month');
    expect(getRelativeRangeLabel(2, 'quarter', 'last')).toBe('Last 2 quarters');
  });

  it('labels a rolling window with its count', () => {
    expect(getRelativeRangeLabel(1, 'month', 'past')).toBe('Past 1 month');
    expect(getRelativeRangeLabel(6, 'month', 'past')).toBe('Past 6 months');
    expect(getRelativeRangeLabel(7, 'day', 'past')).toBe('Past 7 days');
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
