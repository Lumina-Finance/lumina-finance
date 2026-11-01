/**
 * Covers insights API fetch functions that build request paths before insights hooks use them
 *
 * These tests catch regressions where range dates, comparison periods,
 * or insights widget endpoints are not encoded into the expected endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

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
} from '@/api/insights'

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue({})
})

describe('insights fetch functions', () => {
  it('requests insights widgets that use date ranges', async () => {
    await fetchInsightsNetWorth('2026-01-01', '2026-01-31')
    await fetchInsightsCashFlow('2026-02-01', '2026-02-28')
    await fetchInsightsFundFlow('2026-03-01', '2026-03-31')

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/insights/net-worth?from_date=2026-01-01&to_date=2026-01-31',
      expect.anything(),
    )
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/insights/cash-flow?from_date=2026-02-01&to_date=2026-02-28',
      expect.anything(),
    )
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      3,
      '/insights/fund-flow?from_date=2026-03-01&to_date=2026-03-31',
      expect.anything(),
    )
  })

  it('requests insights widgets that use comparison periods', async () => {
    await fetchInsightsPeriodGlance('2026-01-01', '2026-01-31')
    await fetchInsightsIncomeExpenseBreakdown('2026-02-01', '2026-02-28', 'previous_year')
    await fetchInsightsMerchants('2026-03-01', '2026-03-31', 'previous_month')

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/insights/period-glance?from_date=2026-01-01&to_date=2026-01-31&comparison_period=same_length',
      expect.anything(),
    )
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/insights/income-expense-breakdown?from_date=2026-02-01&to_date=2026-02-28&comparison_period=previous_year',
      expect.anything(),
    )
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      3,
      '/insights/merchants?from_date=2026-03-01&to_date=2026-03-31&comparison_period=previous_month',
      expect.anything(),
    )
  })

  it('sends each chosen category on the merchants request and none when nothing is chosen', async () => {
    await fetchInsightsMerchants('2026-03-01', '2026-03-31', 'same_length', ['cat-a', 'cat-b'])
    await fetchInsightsMerchants('2026-03-01', '2026-03-31', 'same_length', [])

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/insights/merchants?from_date=2026-03-01&to_date=2026-03-31&comparison_period=same_length&category_id=cat-a&category_id=cat-b',
      expect.anything(),
    )
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/insights/merchants?from_date=2026-03-01&to_date=2026-03-31&comparison_period=same_length',
      expect.anything(),
    )
  })

  it('requests the savings-rate trend endpoint without range parameters', async () => {
    await fetchInsightsSavingsRateTrend()

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/savings-rate-trend', expect.anything())
  })
})

describe('saved insights range functions', () => {
  it('lists saved ranges from the saved-ranges endpoint', async () => {
    await fetchSavedInsightsRanges()

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/saved-ranges', expect.anything())
  })

  it('creates a saved range with the name, amount, unit, and qualifier', async () => {
    await createSavedInsightsRange({ name: 'Half-year', amount: 6, unit: 'month', qualifier: 'past' })

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/saved-ranges', {
      method: 'POST',
      body: JSON.stringify({ name: 'Half-year', amount: 6, unit: 'month', qualifier: 'past' }),
    })
  })

  it('deletes a saved range by ID', async () => {
    await deleteSavedInsightsRange('range_123')

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/insights/saved-ranges/range_123', {
      method: 'DELETE',
    })
  })
})
