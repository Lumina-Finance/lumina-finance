/**
 * Tests the category answers the Actual Budget import fills in, the choices a transfer row gets, and
 * how payments to off-budget accounts are filed and shown
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { buildImportCategoryMatchOptions } from '@/pages/imports/utils'
import type { ActualJournal, ActualPaymentMode } from '@/pages/imports/actual/types'
import {
  applyActualPaymentModes,
  getActualTransferCategoryOptions,
  getVisibleActualCategorySources,
  inferActualCategoryMappings,
} from '@/pages/imports/actual/utils/categories'
import { normaliseActualBudget } from '@/pages/imports/actual/utils/normalise'
import { buildActualBudget, normaliseActualFixture } from './fixtures'

function category(id: string, name: string, kind: Category['kind'], isSystem = false): Category {
  return { id, name, kind, is_system: isSystem, group_id: null, owner_id: null, icon: null, created_at: '' }
}

const MISCELLANEOUS = category('misc', 'Miscellaneous', 'expense', true)
const TRANSFER = category('transfer', 'Transfer', 'transfer', true)
const BALANCE_ADJUSTMENT = category('balance', 'Balance Adjustment', 'transfer', true)
const GROCERIES = category('groceries', 'groceries', 'expense')
const CAR_INCOME = category('car-income', 'Car', 'income')
const CAR_TRANSFERS = category('car-transfers', 'Car Transfers', 'transfer')
const CATEGORIES = [MISCELLANEOUS, TRANSFER, BALANCE_ADJUSTMENT, GROCERIES, CAR_INCOME, CAR_TRANSFERS]

describe('Actual Budget category defaults', () => {
  it('matches names of the same kind, files rows without a category under Miscellaneous and creates the rest', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const mappings = inferActualCategoryMappings(journal.categories, {}, CATEGORIES)
    const byLabel = Object.fromEntries(journal.categories.map((source) => [source.label, mappings[source.id]]))

    expect(byLabel).toEqual({
      'Car': CREATE_CATEGORY_VALUE,
      'Groceries': GROCERIES.id,
      'Gym': CREATE_CATEGORY_VALUE,
      'Income': CREATE_CATEGORY_VALUE,
      'Travel (Away)': CREATE_CATEGORY_VALUE,
      'Travel (Home)': CREATE_CATEGORY_VALUE,
      'Car (transfers)': CAR_TRANSFERS.id,
      'No category': MISCELLANEOUS.id,
      'No category · Car Loan': MISCELLANEOUS.id,
    })
  })

  it('keeps an answer the user gave', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const groceries = journal.categories.find((source) => source.label === 'Groceries')!

    expect(inferActualCategoryMappings(journal.categories, { [groceries.id]: MISCELLANEOUS.id }, CATEGORIES)[groceries.id]).toBe(MISCELLANEOUS.id)
  })

  it('offers a transfer row only categories that record the other account', () => {
    const options = buildImportCategoryMatchOptions(CATEGORIES)
    const categoryById = new Map(CATEGORIES.map((entry) => [entry.id, entry]))

    expect(getActualTransferCategoryOptions(options, categoryById).map((option) => option.value))
      .toEqual([CREATE_CATEGORY_VALUE, CAR_TRANSFERS.id, TRANSFER.id])
  })

  it('files a transfer whose other side is missing under Transfer, and a payment category under its own transfer category', () => {
    const missing = { id: 'transfer:', role: 'transfer', label: 'Transfers whose other side is missing', createName: 'Transfer', categoryId: null, accountId: null, isIncome: false, rowCount: 1 } as const
    const payment = { ...missing, id: 'transfer:car', label: 'Car (transfers)', createName: 'Car Transfers', categoryId: 'car' }

    expect(inferActualCategoryMappings([missing, payment], {}, CATEGORIES)).toEqual({ [missing.id]: TRANSFER.id, [payment.id]: CAR_TRANSFERS.id })
  })

  it('never matches a group category', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const groupGroceries = { ...category('group-groceries', 'Groceries', 'expense'), group_id: 'family' }
    const groceries = journal.categories.find((source) => source.label === 'Groceries')!

    expect(inferActualCategoryMappings(journal.categories, {}, [groupGroceries, ...CATEGORIES])[groceries.id]).toBe(GROCERIES.id)
    expect(inferActualCategoryMappings(journal.categories, {}, [groupGroceries])[groceries.id]).toBe(CREATE_CATEGORY_VALUE)
  })
})

describe('Actual Budget payments to off-budget accounts', () => {
  // A paired loan payment and one whose loan side doesn't match, both under Car, which Actual budgeted
  const budget = buildActualBudget([
    { id: 'pay', accountId: 'checking', date: '2026-09-01', amount: -30000, payeeId: 'to-loan', transferredId: 'paid', categoryId: 'car' },
    { id: 'paid', accountId: 'loan', date: '2026-09-01', amount: 30000, payeeId: 'to-checking', transferredId: 'pay' },
    { id: 'late-out', accountId: 'checking', date: '2026-09-02', amount: -5000, payeeId: 'to-loan', transferredId: 'late-in', categoryId: 'car' },
    { id: 'late-in', accountId: 'loan', date: '2026-09-03', amount: 5000, payeeId: 'to-checking', transferredId: 'late-out' },
  ], { budgetFigures: [{ month: '2026-09', categoryId: 'car', amount: 35000, carryover: false }] })
  const journal = normaliseActualBudget(budget, '2026-09-26')
  const shape = (entries: ActualJournal['entries']) => entries.map((entry) => [
    entry.transactionId,
    entry.type,
    entry.categorySourceId,
    entry.categoryLeg,
    entry.payeeName,
  ])

  it('files them as spending in their category by default, naming the other account as the payee', () => {
    const effective = applyActualPaymentModes(journal, {})

    expect(shape(effective.entries)).toEqual([
      ['pay', 'transfer', 'car', 'source', 'Loan'],
      ['late-out', 'withdrawal', 'car', null, 'Loan'],
      ['late-in', 'deposit', 'transfer:', null, null],
    ])

    // The category's own source has no rows, so it answers to the transfer row's label
    expect(effective.categories.map((source) => [source.id, source.label])).toEqual([
      ['car', 'Car (transfers)'],
      ['transfer:car', 'Car (transfers)'],
      ['transfer:', 'Transfers whose other side is missing'],
    ])
  })

  it('keeps them as transfers when asked', () => {
    expect(applyActualPaymentModes(journal, { 'transfer:car': 'transfer' })).toBe(journal)
    expect(shape(journal.entries)).toEqual([
      ['pay', 'transfer', 'transfer:car', 'source', null],
      ['late-out', 'withdrawal', 'transfer:car', null, null],
      ['late-in', 'deposit', 'transfer:', null, null],
    ])
  })

  it('shows the category\'s own row only once its payments are transfers and a selected budget tracks it', () => {
    const visible = (modes: Record<string, ActualPaymentMode>, budgetSources: string[]) => (
      getVisibleActualCategorySources(journal.categories, modes, new Set(budgetSources)).map((source) => source.id)
    )

    expect(visible({}, ['car'])).toEqual(['transfer:car', 'transfer:'])
    expect(visible({ 'transfer:car': 'transfer' }, [])).toEqual(['transfer:car', 'transfer:'])
    expect(visible({ 'transfer:car': 'transfer' }, ['car'])).toEqual(['car', 'transfer:car', 'transfer:'])
  })

  it('always shows a category row with rows of its own', async () => {
    const { journal: edges } = await normaliseActualFixture('edges')

    expect(getVisibleActualCategorySources(edges.categories, {}, new Set())).toEqual(edges.categories)
  })
})
