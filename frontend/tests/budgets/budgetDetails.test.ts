/**
 * Tests budget details helpers so chart rows, category colours, period ordering, and utilization math stay stable while the modal is split apart
 */
import { describe, expect, it } from 'vitest'
import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import {
  ARCHIVED_SLOT_LABEL_PREFIX,
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  getBudgetArchivedChartSlots,
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
    is_archived: false,
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

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId,
      chartCategories: categories,
      baseBudget: createBaseBudget(),
    })

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

  it('finds no archived slot between contiguous monthly periods', () => {
    const baseBudget = createBaseBudget()
    const periods = [
      createBudget({ id: 'jan', period_start: '2026-01-01' }),
      createBudget({ id: 'feb', period_start: '2026-02-01' }),
      createBudget({ id: 'mar', period_start: '2026-03-01' }),
    ]

    expect(getBudgetArchivedChartSlots(periods, baseBudget)).toEqual([])
  })

  it('finds no archived slot for a contiguous dom-31 monthly series crossing February', () => {
    const baseBudget = createBaseBudget({ recurrence_dom: 31 })
    const periods = [
      createBudget({ id: 'jan', period_start: '2026-01-31' }),
      createBudget({ id: 'feb', period_start: '2026-02-28' }),
      createBudget({ id: 'mar', period_start: '2026-03-31' }),
    ]

    expect(getBudgetArchivedChartSlots(periods, baseBudget)).toEqual([])
  })

  it('inserts an archived slot between periods separated by more than one monthly cycle', () => {
    const baseBudget = createBaseBudget()
    const periods = [
      createBudget({ id: 'jan', period_start: '2026-01-01' }),

      // Skips February and March, so the gap is wider than one monthly cycle
      createBudget({ id: 'apr', period_start: '2026-04-01' }),
    ]

    expect(getBudgetArchivedChartSlots(periods, baseBudget)).toEqual([
      { label: `${ARCHIVED_SLOT_LABEL_PREFIX}jan`, afterPeriodId: 'jan' },
    ])
  })

  it('appends a trailing archived slot after the last period while the base budget is still archived', () => {
    const baseBudget = createBaseBudget({ is_archived: true })
    const periods = [
      createBudget({ id: 'jan', period_start: '2026-01-01' }),
      createBudget({ id: 'feb', period_start: '2026-02-01' }),
    ]

    expect(getBudgetArchivedChartSlots(periods, baseBudget)).toEqual([
      { label: `${ARCHIVED_SLOT_LABEL_PREFIX}feb-current`, afterPeriodId: 'feb' },
    ])
  })

  it('never produces archived slots for one-off budgets, even when archived', () => {
    const baseBudget = createBaseBudget({ recurs: false, is_archived: true })
    const periods = [
      createBudget({ id: 'jan', period_start: '2026-01-01' }),
      createBudget({ id: 'apr', period_start: '2026-04-01' }),
    ]

    expect(getBudgetArchivedChartSlots(periods, baseBudget)).toEqual([])
  })

  it('interleaves a synthetic archived slot between bracketing bars while keeping real spend values', () => {
    const baseBudget = createBaseBudget()
    const sortedPeriods = [
      createBudget({ id: 'jan', period_start: '2026-01-01', overall_limit: 100000 }),
      createBudget({ id: 'apr', period_start: '2026-04-01', overall_limit: 100000 }),
    ]
    const utilizationByBudgetId = new Map([
      ['jan', createUtilization({ budget_id: 'jan', total_spent: 40000 })],
      ['apr', createUtilization({ budget_id: 'apr', total_spent: 25000 })],
    ])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId,
      chartCategories: [],
      baseBudget,
    })

    expect(chartData).toHaveLength(3)
    expect(chartData[0]).toMatchObject({ label: 'Jan 1, 2026', spent: 40000 })
    expect(chartData[0].archived).toBeFalsy()
    expect(chartData[1]).toMatchObject({ label: `${ARCHIVED_SLOT_LABEL_PREFIX}jan`, archived: true, spent: 0, limit: 0 })
    expect(chartData[2]).toMatchObject({ label: 'Apr 1, 2026', spent: 25000 })
    expect(chartData[2].archived).toBeFalsy()
  })
})
