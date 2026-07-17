/**
 * Tests budget details helpers so chart rows, category colours, period ordering, and utilization math stay stable while the modal is split apart
 */
import { describe, expect, it } from 'vitest'
import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'
import {
  ARCHIVED_SLOT_LABEL_PREFIX,
  BUDGET_CHART_HOVER_HIGHLIGHT_WIDTH,
  getBudgetChartBarTopPct,
  getBudgetChartCategories,
  getBudgetChartGuideMaxWidth,
  getBudgetDetailsChartData,
  getBudgetPeriodHistory,
  getBudgetUtilizationByBudgetId,
  getLatestBudgetCategories,
  getSortedBudgetPeriods,
} from '@/pages/budgets/utils/budgetDetails'

/**
 * Formats a calendar year, month, and day as the backend YYYY-MM-DD period key
 */
function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

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
 * Creates a chart point fixture, spreading per-category dataKey percentages in the same way
 * buildBudgetPeriodPoint attaches its dynamic categoryPct fields
 */
function createChartPoint(
  overrides: Partial<BudgetChartPoint> = {},
  categoryValues: Record<string, number> = {},
): BudgetChartPoint {
  return {
    periodKey: '2026-06-01',
    label: 'Jun 1, 2026',
    axisLabel: 'Jun',
    hasYearAxisLabel: false,
    spent: 0,
    limit: 100000,
    utilizationPct: 0,
    ...overrides,
    ...categoryValues,
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

  it('sorts periods and builds chart rows from the latest twelve periods', () => {
    const periods = Array.from({ length: 13 }, (_, index) => {
      const month = (index % 12) + 1
      const year = 2026 + Math.floor(index / 12)
      return createBudget({
        id: `budget-${index + 1}`,
        period_start: ymd(year, month, 1),
        period_end: ymd(year, month, 28),
        overall_limit: 100000,
      })
    }).reverse()
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
      today: ymd(2027, 1, 1),
    })

    expect(sortedPeriods.map((period) => period.id)).toEqual([
      'budget-1', 'budget-2', 'budget-3', 'budget-4', 'budget-5', 'budget-6', 'budget-7',
      'budget-8', 'budget-9', 'budget-10', 'budget-11', 'budget-12', 'budget-13',
    ])
    expect(chartData).toHaveLength(12)
    expect(chartData.every((point) => !point.archived)).toBe(true)
    expect(chartData[0]).toMatchObject({
      periodKey: '2026-02-01',
      label: 'Feb 1, 2026',
      axisLabel: 'Feb',
      spent: 62500,
      limit: 100000,
      utilizationPct: 63,
      categoryPct0: 25,
      categoryPct1: 12.5,
    })
  })

  it('marks only the period whose range contains today as the current period', () => {
    const jan = createBudget({ id: 'jan', period_start: '2026-01-01', period_end: '2026-01-31' })
    const feb = createBudget({ id: 'feb', period_start: '2026-02-01', period_end: '2026-02-28' })
    const sortedPeriods = getSortedBudgetPeriods([jan, feb])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget: createBaseBudget({ is_archived: false }),

      // Falls inside February's range, so only the February point should be current
      today: '2026-02-15',
    })

    expect(chartData).toHaveLength(2)
    expect(chartData[0]).toMatchObject({ periodKey: '2026-01-01', isCurrent: false })
    expect(chartData[1]).toMatchObject({ periodKey: '2026-02-01', isCurrent: true })
  })

  it('never marks an archived gap column as the current period', () => {
    const baseBudget = createBaseBudget({ is_archived: true })
    const jan = createBudget({ id: 'jan', period_start: '2026-01-01', period_end: '2026-01-31' })
    const sortedPeriods = getSortedBudgetPeriods([jan])

    // "today" sits inside the archived gap that follows the single stored period, not inside any
    // stored period's range
    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget,
      today: ymd(2026, 4, 1),
    })

    expect(chartData[0]).toMatchObject({ periodKey: '2026-01-01', isCurrent: false })
    const archivedPoints = chartData.filter((point) => point.archived)
    expect(archivedPoints.length).toBeGreaterThan(0)
    expect(archivedPoints.every((point) => !point.isCurrent)).toBe(true)
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

  it('shows a wide archived stretch across a ten-cycle gap between two stored periods', () => {
    const baseBudget = createBaseBudget({ is_archived: false })
    const jan = createBudget({ id: 'jan', period_start: '2026-01-01', overall_limit: 100000 })

    // Reactivating after a ten-month gap skips February through November before the next stored period
    const dec = createBudget({ id: 'dec', period_start: '2026-12-01', overall_limit: 100000 })
    const sortedPeriods = getSortedBudgetPeriods([jan, dec])
    const utilizationByBudgetId = new Map([
      ['jan', createUtilization({ budget_id: 'jan', total_spent: 40000 })],
      ['dec', createUtilization({ budget_id: 'dec', total_spent: 25000 })],
    ])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId,
      chartCategories: [],
      baseBudget,
      today: ymd(2027, 6, 1),
    })

    expect(chartData).toHaveLength(12)
    expect(chartData[0]).toMatchObject({ periodKey: '2026-01-01', spent: 40000 })
    expect(chartData[0].archived).toBeFalsy()
    expect(chartData[11]).toMatchObject({ periodKey: '2026-12-01', spent: 25000 })
    expect(chartData[11].archived).toBeFalsy()

    const archivedStretch = chartData.slice(1, 11)
    expect(archivedStretch).toHaveLength(10)
    expect(archivedStretch.every((point) => point.archived)).toBe(true)
    expect(archivedStretch.map((point) => point.periodKey)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ].map((month) => `${ARCHIVED_SLOT_LABEL_PREFIX}${ymd(2026, month, 1)}`))
  })

  it('shades a trailing gap only while the base budget is archived', () => {
    const baseBudget = createBaseBudget({ is_archived: true })
    const jan = createBudget({ id: 'jan', period_start: '2026-01-01' })
    const sortedPeriods = getSortedBudgetPeriods([jan])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget,
      today: ymd(2026, 4, 1),
    })

    expect(chartData).toHaveLength(4)
    expect(chartData[0].periodKey).toBe('2026-01-01')
    expect(chartData[0].archived).toBeFalsy()
    expect(chartData.slice(1)).toHaveLength(3)
    expect(chartData.slice(1).every((point) => point.archived)).toBe(true)
  })

  it('shows no trailing band while a recurring budget merely awaits its next backfill', () => {
    const baseBudget = createBaseBudget({ is_archived: false })
    const jan = createBudget({ id: 'jan', period_start: '2026-01-01' })
    const sortedPeriods = getSortedBudgetPeriods([jan])

    // "today" sits far past the latest stored period, but an active budget stops at that period
    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget,
      today: ymd(2026, 4, 1),
    })

    expect(chartData).toHaveLength(1)
    expect(chartData[0].periodKey).toBe('2026-01-01')
    expect(chartData[0].archived).toBeFalsy()
  })

  it('shows only stored periods with no archived columns for one-off budgets', () => {
    const baseBudget = createBaseBudget({ recurs: false, is_archived: true })
    const periods = [
      createBudget({ id: 'jan', period_start: '2026-01-01' }),

      // One-off budgets never step a cadence, so a wide gap never becomes an archived column
      createBudget({ id: 'oct', period_start: '2026-10-01' }),
    ]
    const sortedPeriods = getSortedBudgetPeriods(periods)

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget,
      today: ymd(2027, 1, 1),
    })

    expect(chartData).toHaveLength(2)
    expect(chartData.map((point) => point.periodKey)).toEqual(['2026-01-01', '2026-10-01'])
    expect(chartData.every((point) => !point.archived)).toBe(true)
  })

  it('labels weekly budget periods with their ISO week number', () => {
    const weeklyBudget = createBaseBudget({
      recurrence_freq: 'weekly',
      recurrence_dom: null,
      recurrence_weekday: 0,
    })
    const first = createBudget({ id: 'w16', period_start: '2026-04-13', period_end: '2026-04-19' })
    const second = createBudget({ id: 'w17', period_start: '2026-04-20', period_end: '2026-04-26' })
    const sortedPeriods = getSortedBudgetPeriods([first, second])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget: weeklyBudget,
      today: '2026-04-25',
    })

    expect(chartData.map((point) => point.axisLabel)).toEqual(['W16', 'W17'])
    expect(chartData.every((point) => !point.hasYearAxisLabel)).toBe(true)
  })

  it('suffixes the first ISO week of the year with the two-digit year', () => {
    const weeklyBudget = createBaseBudget({
      recurrence_freq: 'weekly',
      recurrence_dom: null,
      recurrence_weekday: 0,
    })

    // The Monday of ISO week 1 of 2026 falls on 2025-12-29, so it labels as W1 '26 despite the calendar year
    const weekOne = createBudget({ id: 'w1', period_start: '2025-12-29', period_end: '2026-01-04' })
    const weekTwo = createBudget({ id: 'w2', period_start: '2026-01-05', period_end: '2026-01-11' })
    const sortedPeriods = getSortedBudgetPeriods([weekOne, weekTwo])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget: weeklyBudget,
      today: '2026-01-10',
    })

    expect(chartData.map((point) => point.axisLabel)).toEqual(["W1 '26", 'W2'])
    expect(chartData.map((point) => point.hasYearAxisLabel)).toEqual([true, false])
  })

  it('labels yearly budget periods with the four-digit year', () => {
    const yearlyBudget = createBaseBudget({
      recurrence_freq: 'yearly',
      recurrence_dom: 1,
      recurrence_month: 1,
    })
    const first = createBudget({ id: 'y2025', period_start: '2025-01-01', period_end: '2025-12-31' })
    const second = createBudget({ id: 'y2026', period_start: '2026-01-01', period_end: '2026-12-31' })
    const sortedPeriods = getSortedBudgetPeriods([first, second])

    const chartData = getBudgetDetailsChartData({
      sortedPeriods,
      utilizationByBudgetId: new Map(),
      chartCategories: [],
      baseBudget: yearlyBudget,
      today: '2026-06-15',
    })

    expect(chartData.map((point) => point.axisLabel)).toEqual(['2025', '2026'])
    expect(chartData.every((point) => !point.hasYearAxisLabel)).toBe(true)
  })

  it('sums the shown category percentages as the stacked bar top, ignoring the stored total', () => {
    const categories = [
      { id: 'groceries', name: 'Groceries', kind: 'expense' as const, dataKey: 'categoryPct0', color: '#5D8F6D' },
      { id: 'travel', name: 'Travel', kind: 'expense' as const, dataKey: 'categoryPct1', color: '#7AAEC8' },
    ]

    // Total utilization includes spend in a category no longer tracked, so it sits above the sum
    // of the two categories still rendered on the stacked bar
    const point = createChartPoint({ utilizationPct: 90 }, { categoryPct0: 40, categoryPct1: 35 })

    expect(getBudgetChartBarTopPct(point, categories, true)).toBe(75)
  })

  it('returns the total utilization percentage as the single-category bar top', () => {
    const point = createChartPoint({ utilizationPct: 62 })

    expect(getBudgetChartBarTopPct(point, [], false)).toBe(62)
  })
})
