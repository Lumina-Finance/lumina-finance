/**
 * Tests budget details helpers so chart rows, category colours, period ordering, and utilization math stay stable while the modal is split apart
 */
import { describe, expect, it } from 'vitest'
import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import {
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  getBudgetChartCategories,
  getBudgetChartGuideMaxWidth,
  getBudgetDetailsChartData,
  getBudgetPeriodHistory,
  getBudgetUtilizationByBudgetId,
  getLatestBudgetCategories,
  getSortedBudgetPeriods,
} from '@/pages/budgets/utils/budgetDetails'

/**
 * Creates a base budget fixture with valid recurring monthly defaults
 */
function createBaseBudget(overrides: Partial<BaseBudget> = {}): BaseBudget {
  return {
    id: overrides.id ?? 'base',
    owner_id: null,
    group_id: null,
    name: overrides.name ?? 'Groceries',
    currency: 'CAD',
    recurrence_freq: 'monthly',
    instance_length: 1,
    recurrence_weekday: null,
    recurrence_dom: 1,
    recurrence_month: null,
    recurs: true,
    created_at: '2026-01-01T00:00:00Z',
    category_ids: ['groceries', 'travel'],
    ...overrides,
  }
}

/**
 * Creates a budget period fixture tied to a valid base budget
 */
function createBudget(overrides: Partial<Budget> = {}): Budget {
  const baseBudget = createBaseBudget()

  return {
    id: overrides.id ?? 'budget',
    base_budget_id: baseBudget.id,
    period_start: overrides.period_start ?? '2026-06-01',
    period_end: overrides.period_end ?? '2026-06-30',
    overall_limit: overrides.overall_limit ?? 100000,
    created_at: '2026-06-01T00:00:00Z',
    base_budget: baseBudget,
    ...overrides,
  }
}

/**
 * Creates a utilization fixture with complete FX coverage by default
 */
function createUtilization(overrides: Partial<BudgetUtilization> = {}): BudgetUtilization {
  return {
    budget_id: overrides.budget_id ?? 'budget',
    period_start: overrides.period_start ?? '2026-06-01',
    period_end: overrides.period_end ?? '2026-06-30',
    overall_limit: overrides.overall_limit ?? 100000,
    total_spent: overrides.total_spent ?? 50000,
    categories: overrides.categories ?? [],
    fx_status: overrides.fx_status ?? { state: 'none', missing_pairs: [] },
    ...overrides,
  }
}

/**
 * Creates an expense category fixture for chart metadata tests
 */
function createCategory(overrides: Partial<Category>): Category {
  return {
    id: overrides.id ?? 'category',
    group_id: null,
    owner_id: null,
    name: overrides.name ?? 'Category',
    kind: overrides.kind ?? 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('budget details helpers', () => {
  it('builds chart categories with fallback names and deterministic colour keys', () => {
    const baseBudget = createBaseBudget({ category_ids: ['groceries', 'missing'] })
    const categoryById = new Map([['missing', 'Legacy category']])
    const categories = new Map([
      ['groceries', createCategory({ id: 'groceries', name: 'Groceries' })],
    ])

    expect(getBudgetChartCategories({ baseBudget, categoryById, categoryDetailsById: categories })).toMatchObject([
      {
        id: 'groceries',
        name: 'Groceries',
        kind: 'expense',
        dataKey: 'categoryPct0',
      },
      {
        id: 'missing',
        name: 'Legacy category',
        kind: 'expense',
        dataKey: 'categoryPct1',
      },
    ])
  })

  it('seeds latest utilization before historical query results override by budget ID', () => {
    const seeded = createUtilization({ budget_id: 'budget', total_spent: 1000 })
    const loaded = createUtilization({ budget_id: 'budget', total_spent: 2000 })

    expect(getBudgetUtilizationByBudgetId(seeded, [undefined]).get('budget')?.total_spent).toBe(1000)
    expect(getBudgetUtilizationByBudgetId(seeded, [loaded]).get('budget')?.total_spent).toBe(2000)
  })

  it('sorts periods and builds chart rows from the latest six periods', () => {
    const periods = Array.from({ length: 7 }, (_, index) => createBudget({
      id: `budget-${index + 1}`,
      period_start: `2026-0${index + 1}-01`,
      period_end: `2026-0${index + 1}-28`,
      overall_limit: 100000,
    })).reverse()
    const sortedPeriods = getSortedBudgetPeriods(periods)
    const categories = [
      { id: 'groceries', name: 'Groceries', kind: 'expense' as const, dataKey: 'categoryPct0', color: '#5D8F6D' },
      { id: 'travel', name: 'Travel', kind: 'expense' as const, dataKey: 'categoryPct1', color: '#7AAEC8' },
    ]
    const utilizationByBudgetId = new Map([
      ['budget-2', createUtilization({
        budget_id: 'budget-2',
        total_spent: 62500,
        categories: [
          { category_id: 'groceries', spent: 25000 },
          { category_id: 'travel', spent: 12500 },
        ],
      })],
    ])

    const chartData = getBudgetDetailsChartData({ sortedPeriods, utilizationByBudgetId, chartCategories: categories })

    expect(sortedPeriods.map((period) => period.id)).toEqual([
      'budget-1',
      'budget-2',
      'budget-3',
      'budget-4',
      'budget-5',
      'budget-6',
      'budget-7',
    ])
    expect(chartData).toHaveLength(6)
    expect(chartData[0]).toMatchObject({
      label: 'Feb 1, 2026',
      spent: 62500,
      limit: 100000,
      utilizationPct: 63,
      categoryPct0: 25,
      categoryPct1: 12.5,
    })
  })

  it('builds newest-first period history and sorted current categories', () => {
    const first = createBudget({ id: 'first', period_start: '2026-05-01', overall_limit: 90000 })
    const second = createBudget({ id: 'second', period_start: '2026-06-01', overall_limit: 100000 })
    const utilization = createUtilization({
      budget_id: 'second',
      total_spent: 120000,
      categories: [
        { category_id: 'small', spent: 2000 },
        { category_id: 'large', spent: 8000 },
      ],
    })

    expect(getBudgetPeriodHistory([first, second], new Map([['second', utilization]]))).toMatchObject([
      { period: second, spent: 120000, remaining: -20000 },
      { period: first, spent: 0, remaining: 90000 },
    ])
    expect(getLatestBudgetCategories(utilization).map((category) => category.category_id)).toEqual(['large', 'small'])
  })

  it('clamps chart guide width to the plot area', () => {
    expect(getBudgetChartGuideMaxWidth(40, 3)).toBe(1)
    expect(getBudgetChartGuideMaxWidth(500, 0)).toBe(BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH)
  })
})
