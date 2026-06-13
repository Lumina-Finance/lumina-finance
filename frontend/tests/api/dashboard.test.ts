/**
 * Covers dashboard API fetch functions that build request paths before dashboard hooks use them
 *
 * These tests catch regressions where dashboard window or range parameters are not encoded,
 * or dashboard widgets hit the wrong endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  fetchDashboardCredit,
  fetchDashboardNetWorth,
  fetchDashboardRecentActivity,
  fetchDashboardSavingsRate,
  fetchSpendingBreakdown,
  fetchSpendingComparison,
} from '@/api/dashboard';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('dashboard fetch functions', () => {
  it('requests dashboard widgets that do not need query parameters', async () => {
    await fetchDashboardCredit();
    await fetchDashboardSavingsRate();

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/dashboard/credit');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, '/dashboard/savings-rate');
  });

  it('requests dashboard widgets with rolling day windows', async () => {
    await fetchDashboardNetWorth(120);
    await fetchDashboardRecentActivity(30);

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/dashboard/net-worth?window_days=120',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/dashboard/recent-activity?window_days=30',
    );
  });

  it('requests dashboard spending widgets with calendar ranges', async () => {
    await fetchSpendingComparison('MTD');
    await fetchSpendingBreakdown('YTD');

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/dashboard/spending-comparison?range=MTD',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/dashboard/spending-breakdown?range=YTD',
    );
  });
});
