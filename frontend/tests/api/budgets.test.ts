/**
 * Covers budget API functions that build nested budget request paths before hooks use them
 *
 * These tests catch regressions where base-budget IDs, period IDs,
 * or payload fields are sent to the wrong endpoint or HTTP method
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createBaseBudget,
  createBudgetInstance,
  deleteBaseBudget,
  fetchBaseBudgets,
  fetchBudgetUtilization,
  fetchBudgets,
  fetchLatestBudgetUtilizations,
  updateBaseBudget,
  updateBudget,
} from '@/api/budgets';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('budget API functions', () => {
  it('requests budget list and utilization endpoints', async () => {
    await fetchBaseBudgets();
    await fetchBudgets();
    await fetchBudgetUtilization('budget_123');
    await fetchLatestBudgetUtilizations();

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/base-budgets');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, '/budgets');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(3, '/budgets/budget_123/utilization');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(4, '/budgets/latest-utilizations');
  });

  it('creates base budgets with a JSON payload', async () => {
    const payload = {
      name: 'Groceries',
      currency: 'CAD',
      recurrence_freq: 'monthly' as const,
      instance_length: 1,
      recurrence_weekday: null,
      recurrence_dom: 1,
      recurrence_month: null,
      recurs: true,
      category_ids: ['cat_123'],
      period_start: '2026-06-01',
      overall_limit: 50000,
    };

    await createBaseBudget(payload);

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/base-budgets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  });

  it('creates budget periods under a base budget without sending the route ID in the body', async () => {
    await createBudgetInstance({
      baseBudgetId: 'base_123',
      period_start: '2026-06-01',
      overall_limit: 50000,
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/base-budgets/base_123/budgets', {
      method: 'POST',
      body: JSON.stringify({
        period_start: '2026-06-01',
        overall_limit: 50000,
      }),
    });
  });

  it('updates base budgets and budget periods with JSON patches', async () => {
    await updateBaseBudget({
      id: 'base_123',
      patch: {
        name: 'Food',
        category_ids: ['cat_456'],
      },
    });
    await updateBudget({
      id: 'budget_123',
      patch: {
        overall_limit: 75000,
      },
    });

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/base-budgets/base_123', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Food',
        category_ids: ['cat_456'],
      }),
    });
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, '/budgets/budget_123', {
      method: 'PATCH',
      body: JSON.stringify({
        overall_limit: 75000,
      }),
    });
  });

  it('deletes base budgets by ID', async () => {
    await deleteBaseBudget('base_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/base-budgets/base_123', {
      method: 'DELETE',
    });
  });
});
