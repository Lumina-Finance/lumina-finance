/**
 * Covers the bucket size the charts label their dates by, which has to be the one the backend groups
 * the range into, or a range of weekly bars is labelled by month
 */
import { describe, expect, it } from 'vitest';
import { getChartGranularity } from '@/utils/chartGranularity';

describe('getChartGranularity', () => {
  it.each([
    [31, 'day'],
    [32, 'week'],
    [183, 'week'],
    [184, 'month'],
  ])('groups a %i-day range by %s, as the backend does', (dayCount, granularity) => {
    expect(getChartGranularity(dayCount)).toBe(granularity);
  });
});
