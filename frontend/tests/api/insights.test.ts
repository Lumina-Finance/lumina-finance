/**
 * Covers insights API fetch functions that build request paths before insights hooks use them
 *
 * These tests catch regressions where range dates, comparison periods,
 * or insights widget endpoints are not encoded into the expected endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createSavedInsightsRange,
  deleteSavedInsightsRange,
  fetchInsightsCashFlow,
  fetchInsightsFundFlow,
  fetchInsightsIncomeExpenseBreakdown,
  fetchInsightsMerchants,
  fetchInsightsNetWorth,
  fetchInsightsPeriodGlance,
  fetchInsightsSavingsRateTrend,
  fetchSavedInsightsRanges,
} from '@/api/insights';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('insights fetch functions', () => {
  it('requests insights widgets that use date ranges', async () => {
    await fetchInsightsNetWorth('2026-01-01', '2026-01-31');
    await fetchInsightsCashFlow('2026-02-01', '2026-02-28');
    await fetchInsightsFundFlow('2026-03-01', '2026-03-31');

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/insights/net-worth?from_date=2026-01-01&to_date=2026-01-31',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/insights/cash-flow?from_date=2026-02-01&to_date=2026-02-28',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      3,
      '/insights/fund-flow?from_date=2026-03-01&to_date=2026-03-31',
    );
  });

  it('requests insights widgets that use comparison periods', async () => {
    await fetchInsightsPeriodGlance('2026-01-01', '2026-01-31');
    await fetchInsightsIncomeExpenseBreakdown('2026-02-01', '2026-02-28', 'previous_year');
    await fetchInsightsMerchants('2026-03-01', '2026-03-31', 'previous_month');

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/insights/period-glance?from_date=2026-01-01&to_date=2026-01-31&comparison_period=same_length',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/insights/income-expense-breakdown?from_date=2026-02-01&to_date=2026-02-28&comparison_period=previous_year',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      3,
      '/insights/merchants?from_date=2026-03-01&to_date=2026-03-31&comparison_period=previous_month',
    );
  });

  it('requests the savings-rate trend endpoint without range parameters', async () => {
    await fetchInsightsSavingsRateTrend();

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/savings-rate-trend');
  });
});

describe('saved insights range functions', () => {
  it('lists saved ranges from the saved-ranges endpoint', async () => {
    await fetchSavedInsightsRanges();

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/saved-ranges');
  });

  it('creates a saved range with the name, amount, unit, and qualifier', async () => {
    await createSavedInsightsRange({ name: 'Half-year', amount: 6, unit: 'month', qualifier: 'past' });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/saved-ranges', {
      method: 'POST',
      body: JSON.stringify({ name: 'Half-year', amount: 6, unit: 'month', qualifier: 'past' }),
    });
  });

  it('deletes a saved range by ID', async () => {
    await deleteSavedInsightsRange('range_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/saved-ranges/range_123', {
      method: 'DELETE',
    });
  });
});
