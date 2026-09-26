/**
 * Tests turning Actual Budget's monthly figures into budgets, checked against what the Actual server
 * that wrote each export showed on its budget screen
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { TransactionImportCategoryMapping } from '@/api/transaction-imports'
import { ACTUAL_INCOME_BUDGET_REASON, getActualBudgetAmountReason, getActualBudgetGroupCategoryReason } from '@/pages/imports/actual/constants'
import { formatScaledAmount } from '@/pages/imports/actual/utils/amounts'
import { buildActualBudgetDrafts, buildActualRunBudgets, getActualBudgetRefusal, type ActualBudgetDraft } from '@/pages/imports/actual/utils/budgets'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { normaliseActualBudget } from '@/pages/imports/actual/utils/normalise'
import { buildActualBudget, normaliseActualFixture } from './fixtures'

const CURRENT_MONTH = '2026-09'

function mapEverySource(drafts: ActualBudgetDraft[]): TransactionImportCategoryMapping[] {
  return drafts.flatMap((draft) => draft.categorySourceIds.map((source) => ({ source, category_id: `lumina-${source}` })))
}

function getDraft(drafts: ActualBudgetDraft[], name: string) {
  const draft = drafts.find((candidate) => candidate.name === name)
  if (!draft) throw new Error(`No budget named ${name}`)
  return draft
}

describe('Actual Budget budgets', () => {
  it('keeps every figure the envelope budget showed above zero, month by month', async () => {
    const { budget, journal, manifest } = await normaliseActualFixture('envelope')
    const drafts = buildActualBudgetDrafts(budget, journal, CURRENT_MONTH)

    const shown = manifest.budgets.filter((figure) => !figure.isIncome && Number(figure.budgeted) > 0)
    const drafted = drafts.flatMap((draft) =>
      draft.months.map(({ month, amount }) => [draft.name, month, formatScaledAmount(amount, budget.budgetDecimals, 2)]),
    )
    expect(drafted.sort()).toEqual(shown.map((figure) => [figure.category, figure.month, figure.budgeted]).sort())
  })

  it('writes yen budgets in whole yen and leaves income budgets out', async () => {
    const { budget, journal, manifest } = await normaliseActualFixture('yen')
    const drafts = buildActualBudgetDrafts(budget, journal, CURRENT_MONTH)

    expect(getDraft(drafts, 'Income').disabledReason).toBe(ACTUAL_INCOME_BUDGET_REASON)
    const importable = drafts.filter((draft) => !draft.disabledReason)
    const { budgets } = buildActualRunBudgets(importable, 'JPY', budget.budgetDecimals, 0, mapEverySource(importable))

    const limits = budgets.flatMap((draft) => draft.limits.map((limit) => [draft.name, limit.start.slice(0, 7), limit.amount]))
    const shown = manifest.budgets.filter((figure) => !figure.isIncome && Number(figure.budgeted) > 0)
    expect(limits.sort()).toEqual(shown.map((figure) => [figure.category, figure.month, figure.budgeted]).sort())
    expect(budgets.find((draft) => draft.name === 'Food')?.limits[0]).toEqual({ start: '2026-07-01', end: '2026-07-31', amount: '30000' })
  })

  it('repeats only budgets Actual still budgets for, and archives hidden ones', async () => {
    const { budget, journal } = await normaliseActualFixture('edges')
    const drafts = buildActualBudgetDrafts(budget, journal, CURRENT_MONTH)

    expect(drafts.map((draft) => [draft.name, draft.recurs, draft.isArchived])).toEqual([
      ['Car', true, false],
      ['Groceries', false, false],
      ['Gym', false, true],
      ['Travel (Away)', false, false],
      ['Travel (Home)', false, false],
    ])

    // Car is spent on directly and paid to the off-budget loan, and its budget counts both
    const car = getDraft(drafts, 'Car')
    expect(car.categorySourceIds).toEqual([car.categoryId, `transfer:${car.categoryId}`])

    const { budgets, categories } = buildActualRunBudgets(drafts, 'CAD', budget.budgetDecimals, 2, mapEverySource(drafts))
    const runCar = budgets.find((draft) => draft.name === 'Car')
    expect(runCar?.recurrence).toEqual({ freq: 'monthly', instance_length: 1, weekday: null, dom: 1, month: null })
    expect(runCar?.limits.at(-1)).toEqual({ start: '2026-10-01', end: '2026-10-31', amount: '350.00' })
    expect(budgets.find((draft) => draft.name === 'Groceries')?.recurrence).toBeNull()
    expect(categories.map((mapping) => mapping.source).sort()).toEqual(drafts.flatMap((draft) => draft.categorySourceIds).sort())
  })

  it('refuses a budget whose category is not mapped', async () => {
    const { budget, journal } = await normaliseActualFixture('edges')
    const drafts = buildActualBudgetDrafts(budget, journal, CURRENT_MONTH)

    expect(() => buildActualRunBudgets(drafts, 'CAD', budget.budgetDecimals, 2, [])).toThrow('Car: its category is not mapped')
  })

  it('says why a budget cannot be imported with the answers given', () => {
    const draft: ActualBudgetDraft = {
      categoryId: 'dining',
      name: 'Dining',
      categorySourceIds: ['dining'],
      months: [{ month: '2026-07', amount: 12345 }],
      recurs: false,
      isArchived: false,
      disabledReason: null,
    }
    const groupCategory = { id: 'family-food', name: 'Family food', group_id: 'family' } as Category
    const context = {
      currency: 'JPY',
      budgetDecimals: 2,
      currencyExponent: 0,
      categoryMappings: { dining: CREATE_CATEGORY_VALUE },
      categoryById: new Map([[groupCategory.id, groupCategory]]),
    }

    expect(getActualBudgetRefusal(draft, context)).toBe(getActualBudgetAmountReason('123.45', 'JPY'))
    expect(getActualBudgetRefusal(draft, { ...context, currency: 'CAD', currencyExponent: 2 })).toBeNull()
    expect(getActualBudgetRefusal(draft, { ...context, currencyExponent: null })).toBeNull()
    expect(getActualBudgetRefusal(draft, { ...context, categoryMappings: { dining: 'family-food' } }))
      .toBe(getActualBudgetGroupCategoryReason('Family food'))
  })

  it('repeats a budget last budgeted this month, and not one last budgeted the month before', () => {
    const budget = buildActualBudget([], {
      categories: [
        { id: 'car', name: 'Car', groupName: 'Bills', isIncome: false, hidden: false },
        { id: 'gym', name: 'Gym', groupName: 'Bills', isIncome: false, hidden: false },
      ],
      budgetFigures: [
        { month: '2026-08', categoryId: 'car', amount: 10000, carryover: false },
        { month: CURRENT_MONTH, categoryId: 'car', amount: 10000, carryover: false },
        { month: '2026-08', categoryId: 'gym', amount: 3500, carryover: false },
      ],
    })
    const drafts = buildActualBudgetDrafts(budget, normaliseActualBudget(budget, `${CURRENT_MONTH}-26`), CURRENT_MONTH)

    expect(drafts.map((draft) => [draft.name, draft.recurs])).toEqual([['Car', true], ['Gym', false]])
  })

  it('names budgets for payment categories sharing a name by their groups', () => {
    const payment = (id: string, account: string, payee: string, categoryId: string) => [
      { id: `${id}-out`, accountId: 'checking', date: '2026-09-01', amount: -1000, payeeId: payee, transferredId: `${id}-in`, categoryId },
      { id: `${id}-in`, accountId: account, date: '2026-09-01', amount: 1000, payeeId: 'to-checking', transferredId: `${id}-out` },
    ]
    const budget = buildActualBudget([...payment('car', 'loan', 'to-loan', 'car-loan'), ...payment('boat', 'boat', 'to-boat', 'boat-loan')], {
      categories: [
        { id: 'car-loan', name: 'Loan', groupName: 'Car', isIncome: false, hidden: false },
        { id: 'boat-loan', name: 'Loan', groupName: 'Boat', isIncome: false, hidden: false },
      ],
      budgetFigures: [
        { month: CURRENT_MONTH, categoryId: 'car-loan', amount: 1000, carryover: false },
        { month: CURRENT_MONTH, categoryId: 'boat-loan', amount: 1000, carryover: false },
      ],
    })
    budget.accounts.push({ id: 'boat', name: 'Boat Loan', offBudget: true, closed: false, type: null })
    budget.payees.push({ id: 'to-boat', name: '', transferAccountId: 'boat' })
    const drafts = buildActualBudgetDrafts(budget, normaliseActualBudget(budget, `${CURRENT_MONTH}-26`), CURRENT_MONTH)

    expect(drafts.map((draft) => [draft.name, draft.categorySourceIds])).toEqual([
      ['Loan (Boat)', ['transfer:boat-loan']],
      ['Loan (Car)', ['transfer:car-loan']],
    ])
  })
})
