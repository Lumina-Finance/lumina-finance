/**
 * Tests the category answers the Actual Budget import fills in, the choices a transfer row gets, and
 * how payments to off-budget accounts and credit accounts are filed and shown
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { buildImportCategoryMatchOptions } from '@/pages/imports/utils'
import type { ActualJournal, ActualPaymentMode } from '@/pages/imports/actual/types'
import {
  applyActualCreditPayments,
  applyActualPaymentModes,
  getActualCategoryKind,
  getActualRevolvingAccountIds,
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
const OTHER_INCOME = category('other-income', 'Other Income', 'income', true)
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
      'Car (transfers in Actual)': CAR_TRANSFERS.id,
      '(withdrawal, no category)': MISCELLANEOUS.id,
      '(withdrawal, no category) · Car Loan': MISCELLANEOUS.id,
    })
  })

  it('keeps an answer the user gave', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const groceries = journal.categories.find((source) => source.label === 'Groceries')!

    expect(inferActualCategoryMappings(journal.categories, { [groceries.id]: MISCELLANEOUS.id }, CATEGORIES)[groceries.id]).toBe(MISCELLANEOUS.id)
  })

  // Money in with no category is income, so it can't share Miscellaneous with the spending, on the
  // budget or in an off-budget account
  it('lists money in with no category apart from money out, and files it under Other Income', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      { id: 'paid', accountId: 'checking', date: '2026-09-01', amount: 50000 },
      { id: 'spent', accountId: 'checking', date: '2026-09-02', amount: -2000, payeeId: 'shop' },
      { id: 'refund', accountId: 'loan', date: '2026-09-03', amount: 10000 },
      { id: 'fee', accountId: 'loan', date: '2026-09-04', amount: -2500 },
    ]), '2026-09-26')
    const mappings = inferActualCategoryMappings(journal.categories, {}, [...CATEGORIES, OTHER_INCOME])

    expect(journal.categories.map((source) => [source.label, source.createName, mappings[source.id]])).toEqual([
      ['(withdrawal, no category)', 'Miscellaneous', MISCELLANEOUS.id],
      ['(deposit, no category)', 'Other Income', OTHER_INCOME.id],
      ['(withdrawal, no category) · Loan', 'Loan', MISCELLANEOUS.id],
      ['(deposit, no category) · Loan', 'Loan Income', OTHER_INCOME.id],
    ])
    expect(journal.categories.map(getActualCategoryKind)).toEqual(['expense', 'income', 'expense', 'income'])
  })

  it('offers a transfer row only categories that record the other account', () => {
    const options = buildImportCategoryMatchOptions(CATEGORIES)
    const categoryById = new Map(CATEGORIES.map((entry) => [entry.id, entry]))

    expect(getActualTransferCategoryOptions(options, categoryById).map((option) => option.value))
      .toEqual([CREATE_CATEGORY_VALUE, CAR_TRANSFERS.id, TRANSFER.id])
  })

  it('files a transfer whose other side is missing under Transfer, and a payment category under its own transfer category', () => {
    const missing = { id: 'transfer:', role: 'transfer', label: 'Transfers whose other side is missing', createName: 'Transfer', categoryId: null, accountId: null, isIncome: false, rowCount: 1 } as const
    const payment = { ...missing, id: 'transfer:car', label: 'Car (transfers in Actual)', createName: 'Car Transfers', categoryId: 'car' }

    expect(inferActualCategoryMappings([missing, payment], {}, CATEGORIES)).toEqual({ [missing.id]: TRANSFER.id, [payment.id]: CAR_TRANSFERS.id })
  })

  it('matches payments kept as transfers to a transfer category of their Actual name first, like the built-in Credit Card Payment', () => {
    const cardPayment = category('card-payment', 'Credit Card Payment', 'transfer', true)
    const spending = { id: 'visa', role: 'spending', label: 'Credit Card Payment', createName: 'Credit Card Payment', categoryId: 'visa', accountId: null, isIncome: false, rowCount: 0 } as const
    const payment = { ...spending, id: 'transfer:visa', role: 'transfer', label: 'Credit Card Payment (transfers in Actual)', createName: 'Credit Card Payment Transfers' } as const

    expect(inferActualCategoryMappings([spending, payment], {}, [...CATEGORIES, cardPayment]))
      .toEqual({ [spending.id]: CREATE_CATEGORY_VALUE, [payment.id]: cardPayment.id })
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

  it('files them as spending in their category when asked, naming the other account as the payee', () => {
    const effective = applyActualPaymentModes(journal, { 'transfer:car': 'category' })

    expect(shape(effective.entries)).toEqual([
      ['pay', 'transfer', 'car', 'source', 'Loan'],
      ['late-out', 'withdrawal', 'car', null, 'Loan'],
      ['late-in', 'deposit', 'transfer:', null, null],
    ])

    // The category's own source has no rows, so it answers to the transfer row's label
    expect(effective.categories.map((source) => [source.id, source.label])).toEqual([
      ['car', 'Car (transfers in Actual)'],
      ['transfer:car', 'Car (transfers in Actual)'],
      ['transfer:', 'Transfers whose other side is missing'],
    ])
  })

  it('files an income category\'s payments from an off-budget account as income on the budget side', () => {
    const incomeBudget = buildActualBudget([
      { id: 'draw', accountId: 'checking', date: '2026-09-01', amount: 20000, payeeId: 'to-loan', transferredId: 'drawn', categoryId: 'bonus' },
      { id: 'drawn', accountId: 'loan', date: '2026-09-01', amount: -20000, payeeId: 'to-checking', transferredId: 'draw' },
    ], { categories: [{ id: 'bonus', name: 'Bonus', groupName: 'Income', isIncome: true, hidden: false }] })
    const effective = applyActualPaymentModes(normaliseActualBudget(incomeBudget, '2026-09-26'), { 'transfer:bonus': 'category' })

    expect(shape(effective.entries)).toEqual([['drawn', 'transfer', 'bonus', 'destination', 'Loan']])
    expect(getActualCategoryKind(effective.categories.find((source) => source.id === 'bonus')!)).toBe('income')
  })

  it('keeps them as transfers by default', () => {
    expect(applyActualPaymentModes(journal, {})).toBe(journal)
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

    expect(visible({ 'transfer:car': 'category' }, ['car'])).toEqual(['transfer:car', 'transfer:'])
    expect(visible({ 'transfer:car': 'transfer' }, [])).toEqual(['transfer:car', 'transfer:'])
    expect(visible({}, ['car'])).toEqual(['car', 'transfer:car', 'transfer:'])
  })

  it('always shows a category row with rows of its own', async () => {
    const { journal: edges } = await normaliseActualFixture('edges')

    expect(getVisibleActualCategorySources(edges.categories, {}, new Set())).toEqual(edges.categories)
  })
})

describe('Actual Budget credit card payments', () => {
  // A card payment from checking, a refund from the card back to checking, and a move to savings
  const budget = buildActualBudget([
    { id: 'pay-card', accountId: 'checking', date: '2026-09-01', amount: -10000, payeeId: 'to-visa', transferredId: 'card-paid' },
    { id: 'card-paid', accountId: 'visa', date: '2026-09-01', amount: 10000, payeeId: 'to-checking', transferredId: 'pay-card' },
    { id: 'refund', accountId: 'visa', date: '2026-09-02', amount: -2000, payeeId: 'to-checking', transferredId: 'refunded' },
    { id: 'refunded', accountId: 'checking', date: '2026-09-02', amount: 2000, payeeId: 'to-visa', transferredId: 'refund' },
    { id: 'save', accountId: 'checking', date: '2026-09-03', amount: -5000, payeeId: 'to-savings', transferredId: 'saved' },
    { id: 'saved', accountId: 'savings', date: '2026-09-03', amount: 5000, payeeId: 'to-checking', transferredId: 'save' },
  ], {
    accounts: [
      { id: 'checking', name: 'Checking', offBudget: false, closed: false, type: null },
      { id: 'savings', name: 'Savings', offBudget: false, closed: false, type: null },
      { id: 'visa', name: 'Visa', offBudget: false, closed: false, type: null },
    ],
    payees: [
      { id: 'to-checking', name: '', transferAccountId: 'checking' },
      { id: 'to-savings', name: '', transferAccountId: 'savings' },
      { id: 'to-visa', name: '', transferAccountId: 'visa' },
    ],
  })
  const journal = normaliseActualBudget(budget, '2026-09-26')
  const shape = (entries: ActualJournal['entries']) => entries.map((entry) => [entry.transactionId, entry.categorySourceId, entry.categoryLeg])

  it('files a transfer into a credit account under its own source on both legs, and leaves the rest as transfers', () => {
    const effective = applyActualCreditPayments(journal, new Set(['visa']))

    expect(shape(effective.entries)).toEqual([
      ['pay-card', 'credit-payment:', 'both'],
      ['refund', null, null],
      ['save', null, null],
    ])
    expect(effective.categories.map((source) => [source.id, source.role, source.createName, source.rowCount])).toEqual([
      ['credit-payment:', 'transfer', 'Credit Card Payment', 1],
    ])
  })

  it('leaves the journal as it is without a credit account, or when both sides are credit accounts', () => {
    expect(applyActualCreditPayments(journal, new Set())).toBe(journal)
    expect(applyActualCreditPayments(journal, new Set(['visa', 'checking']))).toBe(journal)
  })

  it('leaves a payment Actual gave a category to that category and its payment mode', () => {
    const categorised = normaliseActualBudget(buildActualBudget([
      { id: 'pay', accountId: 'checking', date: '2026-09-01', amount: -30000, payeeId: 'to-loan', transferredId: 'paid', categoryId: 'car' },
      { id: 'paid', accountId: 'loan', date: '2026-09-01', amount: 30000, payeeId: 'to-checking', transferredId: 'pay' },
    ]), '2026-09-26')

    expect(applyActualCreditPayments(categorised, new Set(['loan']))).toBe(categorised)
    expect(shape(categorised.entries)).toEqual([['pay', 'transfer:car', 'source']])
  })

  it('matches them to the built-in Credit Card Payment', () => {
    const creditCardPayment = category('credit-card-payment', 'Credit Card Payment', 'transfer', true)
    const { categories } = applyActualCreditPayments(journal, new Set(['visa']))

    expect(inferActualCategoryMappings(categories, {}, [...CATEGORIES, creditCardPayment])).toEqual({ 'credit-payment:': creditCardPayment.id })
  })
})

describe('Actual Budget revolving credit accounts', () => {
  const accountById = new Map([
    ['visa-card', { account_kind: 'revolving' as const }],
    ['everyday', { account_kind: 'asset' as const }],
  ])
  const details = {
    new: { accountType: 'credit_card' },
    'new-heloc': { accountType: 'heloc' },
    'new-savings': { accountType: 'savings' },
    linked: { accountType: 'checking' },
    'linked-asset': { accountType: 'credit_card' },
    unanswered: { accountType: 'credit_card' },
  }

  it('follows the type a new account is created as, and the kind of an existing account it is linked to', () => {
    const revolving = getActualRevolvingAccountIds(Object.keys(details), {
      'new': CREATE_ACCOUNT_VALUE,
      'new-heloc': CREATE_ACCOUNT_VALUE,
      'new-savings': CREATE_ACCOUNT_VALUE,
      'linked': 'visa-card',
      'linked-asset': 'everyday',
      'unanswered': '',
    }, details, accountById)

    expect([...revolving].sort()).toEqual(['linked', 'new', 'new-heloc'])
  })
})
