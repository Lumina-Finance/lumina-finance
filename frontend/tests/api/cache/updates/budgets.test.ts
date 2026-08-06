/**
 * Tests the base-budget cache write helper that the archive toggle relies on for its optimistic update
 *
 * useUpdateBaseBudget itself calls useMutation and useQueryClient, which need a live React tree to
 * invoke, so this covers updateCachedBaseBudget directly against a real QueryClient instead
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { BaseBudget, Budget } from '@/api/budgets';
import { budgetKeys } from '@/api/cache/queryKeys';
import { updateCachedBaseBudget } from '@/api/cache/updates/budgets';

/**
 * Creates a base budget fixture with valid recurring monthly defaults
 */
function createBaseBudget(overrides: Partial<BaseBudget> = {}): BaseBudget {
  return {
    id: overrides.id ?? 'base',
    owner_id: null,
    group_id: null,
    name: 'Groceries',
    currency: 'CAD',
    recurrence_freq: 'monthly',
    instance_length: 1,
    recurrence_weekday: null,
    recurrence_dom: 1,
    recurrence_month: null,
    recurs: true,
    created_at: '2026-01-01T00:00:00Z',
    is_archived: false,
    category_ids: ['groceries'],
    ...overrides,
  };
}

/**
 * Creates a budget period fixture that embeds the supplied base budget
 */
function createBudget(baseBudget: BaseBudget, overrides: Partial<Budget> = {}): Budget {
  return {
    id: overrides.id ?? 'budget',
    base_budget_id: baseBudget.id,
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    overall_limit: 100000,
    created_at: '2026-06-01T00:00:00Z',
    base_budget: baseBudget,
    ...overrides,
  };
}

describe('updateCachedBaseBudget', () => {
  it('replaces the matching entry in the cached base-budget list and leaves others untouched', () => {
    const queryClient = new QueryClient();
    const archived = createBaseBudget({ id: 'base-1' });
    const other = createBaseBudget({ id: 'base-2', name: 'Rent' });
    queryClient.setQueryData(budgetKeys.baseBudgets(), [archived, other]);

    const updated = { ...archived, is_archived: true };
    updateCachedBaseBudget(queryClient, updated);

    expect(queryClient.getQueryData<BaseBudget[]>(budgetKeys.baseBudgets())).toEqual([updated, other]);
  });

  it('does not create a base-budget list cache entry when none was cached yet', () => {
    const queryClient = new QueryClient();

    updateCachedBaseBudget(queryClient, createBaseBudget({ id: 'base-1', is_archived: true }));

    expect(queryClient.getQueryData(budgetKeys.baseBudgets())).toBeUndefined();
  });

  it('updates the base_budget embedded in every cached period for that base budget', () => {
    const queryClient = new QueryClient();
    const baseBudget = createBaseBudget({ id: 'base-1' });
    const otherBaseBudget = createBaseBudget({ id: 'base-2', name: 'Rent' });
    const firstPeriod = createBudget(baseBudget, { id: 'period-1', period_start: '2026-05-01' });
    const secondPeriod = createBudget(baseBudget, { id: 'period-2', period_start: '2026-06-01' });
    const unrelatedPeriod = createBudget(otherBaseBudget, { id: 'period-3' });
    queryClient.setQueryData(budgetKeys.periods(), [firstPeriod, secondPeriod, unrelatedPeriod]);

    const updatedBaseBudget = { ...baseBudget, is_archived: true };
    updateCachedBaseBudget(queryClient, updatedBaseBudget);

    const cachedPeriods = queryClient.getQueryData<Budget[]>(budgetKeys.periods());
    expect(cachedPeriods?.[0].base_budget).toEqual(updatedBaseBudget);
    expect(cachedPeriods?.[1].base_budget).toEqual(updatedBaseBudget);
    expect(cachedPeriods?.[2].base_budget).toEqual(otherBaseBudget);
  });

  it('does not create a periods cache entry when none was cached yet', () => {
    const queryClient = new QueryClient();

    updateCachedBaseBudget(queryClient, createBaseBudget({ id: 'base-1', is_archived: true }));

    expect(queryClient.getQueryData(budgetKeys.periods())).toBeUndefined();
  });
});
