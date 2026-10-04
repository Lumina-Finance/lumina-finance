/**
 * Tests compiling a normalised Actual Budget export and the user's answers into the upload
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  ACTUAL_CATEGORY_RENAME_APP_NAME,
  getActualAmountPrecisionReason,
  getActualCategoryNameTooLongError,
  getActualFileCurrencyError,
  getActualMixedCurrencyError,
  getActualPaymentCategoryError,
  getActualSharedAccountError,
  getActualTransferCategoryError,
} from '@/pages/imports/actual/constants'
import type { ActualJournal } from '@/pages/imports/actual/types'
import { normaliseActualBudget } from '@/pages/imports/actual/utils/normalise'
import { applyActualCreditPayments } from '@/pages/imports/actual/utils/categories'
import { buildActualImportPayload, type ActualImportAnswers } from '@/pages/imports/actual/utils/payload'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  getCategoryCreateClashError,
  getCategoryDirectionClashError,
  getImportAccountCurrencyRequiredError,
  getImportAccountMappingError,
  getImportGroupAccountError,
  getImportGroupCategoryError,
  getImportReadOnlyAccountMappingError,
  JOURNAL_ROW_FIELD_MAX_LENGTHS,
} from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { getImportCategoryRenames } from '@/pages/imports/utils'
import { buildActualBudget, fileActualPaymentsInCategory, normaliseActualFixture } from './fixtures'

const CURRENCIES = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
] as Currency[]

const CHEQUING = { id: 'chequing', name: 'Chequing', currency: 'CAD', can_write: true, is_archived: false } as AccountsOverview
const ARCHIVED = { id: 'old-savings', name: 'Old Savings', currency: 'CAD', can_write: true, is_archived: true } as AccountsOverview
const GROCERIES = { id: 'groceries', name: 'Groceries', kind: 'expense', group_id: null } as Category
const CAR_INCOME = { id: 'car-income', name: 'Car', kind: 'income', group_id: null } as Category
const TRANSFER = { id: 'transfer', name: 'Transfer', kind: 'transfer', group_id: null, is_system: true } as Category
const BALANCE_ADJUSTMENT = { id: 'balance', name: 'Balance Adjustment', kind: 'transfer', group_id: null, is_system: true } as Category

/** Creates every account in one currency and every category with the kind its role suggests */
function createAnswers(journal: ActualJournal, currency = 'CAD'): ActualImportAnswers {
  const kindOf = (role: string, isIncome: boolean): ImportCategoryKind =>
    role === 'transfer' ? 'transfer' : isIncome ? 'income' : 'expense'
  return {
    accountMappings: Object.fromEntries(journal.accounts.map((account) => [account.id, CREATE_ACCOUNT_VALUE])),
    accountCreateDetails: Object.fromEntries(
      journal.accounts.map((account) => [account.id, { accountType: account.proposedType, currency, institutionId: '' }]),
    ),
    accountById: new Map([CHEQUING, ARCHIVED].map((account) => [account.id, account])),
    categoryMappings: Object.fromEntries(journal.categories.map((source) => [source.id, CREATE_CATEGORY_VALUE])),
    categoryCreateKinds: Object.fromEntries(journal.categories.map((source) => [source.id, kindOf(source.role, source.isIncome)])),
    categoryRenames: {},
    categoryById: new Map([[GROCERIES.id, GROCERIES]]),
    currencies: CURRENCIES,
    fileCurrency: null,
    budgetCategorySources: new Set(),
  }
}

function findAccountId(journal: ActualJournal, name: string) {
  const account = journal.accounts.find((candidate) => candidate.name === name)
  if (!account) throw new Error(`No account named ${name}`)
  return account.id
}

describe('Actual Budget import payload', () => {
  it('uploads every row, with loan payments kept as transfers categorised on the budget side and closed accounts archived', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const build = buildActualImportPayload(journal, createAnswers(journal))

    expect(build.errors).toEqual([])
    expect(build.currency).toBe('CAD')
    expect(build.skippedRows).toEqual([])
    expect(build.payload?.rows).toHaveLength(journal.entries.length)
    expect(build.archiveAccountSources).toEqual([findAccountId(journal, 'Wallet')])

    const car = journal.categories.find((source) => source.label === 'Car')!
    const payments = build.payload!.rows.filter((row) => row.category_leg)
    expect(payments.map((row) => [row.dt, row.type, row.amount, row.category, row.category_leg])).toEqual([
      ['2026-07-05', 'transfer', '300.00', `transfer:${car.categoryId}`, 'source'],
      ['2026-08-05', 'transfer', '300.00', `transfer:${car.categoryId}`, 'source'],
      ['2026-09-05', 'transfer', '300.00', `transfer:${car.categoryId}`, 'source'],
    ])
    expect(build.payload!.categories).toContainEqual({
      source: `transfer:${car.categoryId}`,
      create: { name: 'Car Transfers', kind: 'transfer', icon: expect.any(String) },
    })
  })

  it('files loan payments as spending in their category when asked, naming the loan as the payee', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const effective = fileActualPaymentsInCategory(journal)
    const build = buildActualImportPayload(effective, createAnswers(effective))

    expect(build.errors).toEqual([])
    const car = journal.categories.find((source) => source.label === 'Car')!
    const payments = build.payload!.rows.filter((row) => row.category_leg)
    expect(payments.map((row) => [row.dt, row.type, row.category, row.category_leg, row.source_name, row.destination_name])).toEqual([
      ['2026-07-05', 'transfer', car.id, 'source', null, 'Car Loan'],
      ['2026-08-05', 'transfer', car.id, 'source', null, 'Car Loan'],
      ['2026-09-05', 'transfer', car.id, 'source', null, 'Car Loan'],
    ])
    expect(build.payload!.categories).toContainEqual({ source: car.id, create: { name: 'Car', kind: 'expense', icon: expect.any(String) } })
    expect(build.payload!.categories.some((mapping) => mapping.source === `transfer:${car.categoryId}`)).toBe(false)
  })

  it('keeps a payment filed as spending off a transfer category that can\'t record the other account', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const effective = fileActualPaymentsInCategory(journal)
    const answers = createAnswers(effective)
    const car = journal.categories.find((source) => source.label === 'Car')!
    answers.categoryById.set(BALANCE_ADJUSTMENT.id, BALANCE_ADJUSTMENT)
    answers.categoryMappings[car.id] = BALANCE_ADJUSTMENT.id

    expect(buildActualImportPayload(effective, answers).errors).toEqual([getActualPaymentCategoryError('Car', 'Balance Adjustment')])

    // A transfer category that records the other account keeps the payment a transfer
    answers.categoryById.set(TRANSFER.id, TRANSFER)
    answers.categoryMappings[car.id] = TRANSFER.id
    expect(buildActualImportPayload(effective, answers).errors).toEqual([])
  })

  // The case the rename exists for: payments filed as spending in Car Payment, a name the user
  // already has for transfers, which the commit would otherwise refuse
  it('creates a category under the proposed name when another kind holds its own', async () => {
    const { journal } = await normaliseActualFixture('envelope')
    const effective = fileActualPaymentsInCategory(journal)
    const answers = createAnswers(effective)
    const carPayment = { id: 'car-payment', name: 'Car Payment', kind: 'transfer', group_id: null } as Category
    answers.categoryById.set(carPayment.id, carPayment)

    answers.categoryRenames = getImportCategoryRenames({
      sources: effective.categories.map((source) => ({ id: source.id, name: source.createName })),
      mappings: answers.categoryMappings,
      kinds: answers.categoryCreateKinds,
      typedNames: {},
      categoryById: answers.categoryById,
      appName: ACTUAL_CATEGORY_RENAME_APP_NAME,
    })

    const build = buildActualImportPayload(effective, answers)
    expect(build.errors).toEqual([])
    expect(build.payload?.categories).toContainEqual(expect.objectContaining({
      create: { name: 'Car Payment (Actual)', kind: 'expense', icon: DEFAULT_CATEGORY_ICON },
    }))

    // A cleared name stops the upload instead of creating a category with no name
    for (const rename of Object.values(answers.categoryRenames)) rename.name = ' '
    expect(buildActualImportPayload(effective, answers).errors).toEqual(['Enter a name for the new category from Car Payment (transfers in Actual).'])
  })

  it('writes yen rows in whole yen', async () => {
    const { journal } = await normaliseActualFixture('yen')
    const build = buildActualImportPayload(journal, { ...createAnswers(journal, 'JPY'), fileCurrency: 'JPY' })

    expect(build.errors).toEqual([])
    expect(build.payload?.rows.find((row) => row.dt === '2026-07-10')).toMatchObject({ amount: '4580', currency_code: 'JPY', destination_name: 'Lawson' })
  })

  it('leaves out rows a currency without cents cannot hold', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const build = buildActualImportPayload(journal, createAnswers(journal, 'JPY'))

    expect(build.errors).toEqual([])
    const groceries = build.skippedRows.find((row) => row.date === '2026-07-03')
    expect(groceries).toMatchObject({ accountName: 'Checking', amount: -6420, reason: getActualAmountPrecisionReason('64.20', 'JPY') })
    expect(build.payload?.rows.some((row) => row.dt === '2026-07-03')).toBe(false)
  })

  it('names each account answer the commit would refuse', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const answers = createAnswers(journal)
    const checking = findAccountId(journal, 'Checking')
    const savings = findAccountId(journal, 'Savings')
    const wallet = findAccountId(journal, 'Wallet')
    const carLoan = findAccountId(journal, 'Car Loan')

    delete answers.accountMappings[carLoan]
    answers.accountMappings[checking] = CHEQUING.id
    answers.accountMappings[savings] = CHEQUING.id
    answers.accountMappings[wallet] = ARCHIVED.id

    const build = buildActualImportPayload(journal, answers)
    expect(build.payload).toBeNull()
    expect(build.errors).toEqual([
      getImportAccountMappingError('Car Loan'),
      getImportReadOnlyAccountMappingError('Wallet', ARCHIVED),
      getActualSharedAccountError(['Checking', 'Savings'], 'Chequing'),
    ])
  })

  it('asks for one currency across every account', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const answers = createAnswers(journal)
    answers.accountCreateDetails[findAccountId(journal, 'Savings')].currency = 'JPY'
    answers.accountCreateDetails[findAccountId(journal, 'Wallet')].currency = ''

    expect(buildActualImportPayload(journal, answers).errors).toEqual([
      getImportAccountCurrencyRequiredError('Wallet'),
      getActualMixedCurrencyError(['CAD', 'JPY']),
    ])
  })

  it('does not send an existing account the file has no rows for', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const empty = { ...journal.accounts[0], id: 'empty', name: 'Empty', label: 'Empty', rowCount: 0, balance: 0 }
    const withEmpty = { ...journal, accounts: [...journal.accounts, empty] }
    const answers = createAnswers(withEmpty)
    answers.accountMappings.empty = CHEQUING.id

    const build = buildActualImportPayload(withEmpty, answers)
    expect(build.errors).toEqual([])
    expect(build.payload?.accounts.some((mapping) => mapping.source === 'empty')).toBe(false)
  })

  it('names each category answer the commit would refuse', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const answers = createAnswers(journal)
    const car = journal.categories.find((source) => source.label === 'Car')!
    const carTransfers = journal.categories.find((source) => source.role === 'transfer')!
    const gym = journal.categories.find((source) => source.label === 'Gym')!

    // A transfer source matched to a spending category, and one created as spending
    answers.categoryMappings[carTransfers.id] = GROCERIES.id
    // Car would be created beside an income category of that name
    answers.categoryById.set(CAR_INCOME.id, CAR_INCOME)
    answers.categoryCreateKinds[car.id] = 'expense'
    // Gym would be created twice under one name with two kinds
    const gymTwin = { ...gym, id: 'gym-twin', label: 'Gym (Twin)', categoryId: null }
    const withTwin = { ...journal, categories: [...journal.categories, gymTwin] }
    answers.categoryMappings[gymTwin.id] = CREATE_CATEGORY_VALUE
    answers.categoryCreateKinds[gymTwin.id] = 'income'
    const gymRow = journal.entries.find((entry) => entry.categorySourceId === gym.id)!
    withTwin.entries = [...journal.entries, { ...gymRow, transactionId: 'gym-twin-row', categorySourceId: gymTwin.id }]

    const errors = buildActualImportPayload(withTwin, answers).errors
    expect(errors).toEqual(expect.arrayContaining([
      getActualTransferCategoryError(carTransfers.label),
      getCategoryDirectionClashError('Car', 'Car', 'income'),
      getCategoryCreateClashError('Gym', 'Gym (Twin)'),
    ]))
    expect(errors).toHaveLength(3)

    answers.categoryMappings[carTransfers.id] = CREATE_CATEGORY_VALUE
    answers.categoryCreateKinds[carTransfers.id] = 'expense'
    expect(buildActualImportPayload(journal, answers).errors).toContain(getActualTransferCategoryError(carTransfers.label))
  })

  it('answers the categories a budget tracks even where no row uses them', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const car = journal.categories.find((source) => source.label === 'Car')!
    const unused = { ...car, id: 'unused', label: 'Unused', createName: 'Unused', categoryId: 'unused', rowCount: 0 }
    const withUnused = { ...journal, categories: [...journal.categories, unused] }
    const answers = { ...createAnswers(withUnused), budgetCategorySources: new Set([car.id, 'unused']) }

    const build = buildActualImportPayload(withUnused, answers)
    expect(build.errors).toEqual([])
    expect(build.payload?.categories.some((mapping) => mapping.source === 'unused')).toBe(false)
    expect(build.budgetCategoryMappings.map((mapping) => mapping.source)).toEqual([car.id, 'unused'])
  })

  it('keeps every account in the currency the file records', async () => {
    const { journal } = await normaliseActualFixture('yen')
    const answers = { ...createAnswers(journal, 'CAD'), fileCurrency: 'JPY' }

    expect(buildActualImportPayload(journal, answers).errors)
      .toEqual([getActualFileCurrencyError('JPY', journal.accounts.map((account) => account.label))])

    // An existing account counts by its own currency
    const linked = { ...createAnswers(journal, 'JPY'), fileCurrency: 'JPY' }
    linked.accountMappings[journal.accounts[0].id] = CHEQUING.id
    expect(buildActualImportPayload(journal, linked).errors).toContain(getActualFileCurrencyError('JPY', [journal.accounts[0].label]))
  })

  it('files payments kept as transfers under the built-in Transfer category when asked', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const answers = createAnswers(journal)
    const carTransfers = journal.categories.find((source) => source.role === 'transfer')!
    answers.categoryById.set(TRANSFER.id, TRANSFER)
    answers.categoryMappings[carTransfers.id] = TRANSFER.id

    const build = buildActualImportPayload(journal, answers)
    expect(build.errors).toEqual([])
    expect(build.payload!.categories).toContainEqual({ source: carTransfers.id, category_id: TRANSFER.id })
  })

  it('sends a credit card payment with its category on both legs, under Credit Card Payment, Transfer or a new one', () => {
    const budget = buildActualBudget([
      { id: 'pay-card', accountId: 'checking', date: '2026-09-01', amount: -10000, payeeId: 'to-savings', transferredId: 'card-paid' },
      { id: 'card-paid', accountId: 'savings', date: '2026-09-01', amount: 10000, payeeId: 'to-checking', transferredId: 'pay-card' },
    ])
    const journal = applyActualCreditPayments(normaliseActualBudget(budget, '2026-09-26'), new Set(['savings']))
    const creditCardPayment = { id: 'credit-card-payment', name: 'Credit Card Payment', kind: 'transfer', group_id: null, is_system: true } as Category

    for (const choice of [creditCardPayment.id, TRANSFER.id, CREATE_CATEGORY_VALUE]) {
      const answers = createAnswers(journal)
      answers.categoryById.set(creditCardPayment.id, creditCardPayment)
      answers.categoryById.set(TRANSFER.id, TRANSFER)
      answers.categoryMappings['credit-payment:'] = choice

      const build = buildActualImportPayload(journal, answers)
      expect(build.errors).toEqual([])
      const [row] = build.payload!.rows
      expect([row.category, row.category_leg, row.source_name, row.destination_name]).toEqual(['credit-payment:', 'both', null, null])
      expect(build.payload!.categories.filter((mapping) => mapping.source === 'credit-payment:')).toEqual([
        choice === CREATE_CATEGORY_VALUE
          ? { source: 'credit-payment:', create: expect.objectContaining({ name: 'Credit Card Payment', kind: 'transfer' }) }
          : { source: 'credit-payment:', category_id: choice },
      ])
    }
  })

  it('creates a closed account open while it holds a row dated after today, sending or receiving', () => {
    const accounts = [
      { id: 'checking', name: 'Checking', offBudget: false, closed: false, type: null },
      { id: 'paid-off', name: 'Paid Off', offBudget: false, closed: true, type: null },
      { id: 'upcoming', name: 'Upcoming', offBudget: false, closed: true, type: null },
      { id: 'receiving', name: 'Receiving', offBudget: false, closed: true, type: null },
    ]
    const payees = [
      { id: 'to-checking', name: '', transferAccountId: 'checking' },
      { id: 'to-receiving', name: '', transferAccountId: 'receiving' },
      { id: 'shop', name: 'Corner Shop', transferAccountId: null },
    ]
    const journal = normaliseActualBudget(buildActualBudget([
      { id: 'past', accountId: 'paid-off', date: '2026-09-01', amount: -1000, payeeId: 'shop' },
      { id: 'future', accountId: 'upcoming', date: '2026-10-01', amount: -1000, payeeId: 'shop' },
      // Only the sending side is uploaded, so the closed account appears on its row alone
      { id: 'out', accountId: 'checking', date: '2026-10-01', amount: -2000, payeeId: 'to-receiving', transferredId: 'in' },
      { id: 'in', accountId: 'receiving', date: '2026-10-01', amount: 2000, payeeId: 'to-checking', transferredId: 'out' },
    ], { accounts, payees }), '2026-09-26')
    const build = buildActualImportPayload(journal, createAnswers(journal))

    expect(build.errors).toEqual([])
    expect(build.payload?.rows).toHaveLength(3)
    expect(build.archiveAccountSources).toEqual(['paid-off'])
  })

  it('writes a closed account linked to an existing one into it, leaving that account open', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const answers = createAnswers(journal)
    const wallet = findAccountId(journal, 'Wallet')
    answers.accountMappings[wallet] = CHEQUING.id

    const build = buildActualImportPayload(journal, answers)
    expect(build.errors).toEqual([])
    expect(build.payload?.accounts).toContainEqual({ source: wallet, account_id: CHEQUING.id })
    expect(build.archiveAccountSources).toEqual([])
  })

  it('keeps rows off group categories and group accounts', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const answers = createAnswers(journal)
    const groceries = journal.categories.find((source) => source.label === 'Groceries')!
    const familyGroceries = { ...GROCERIES, id: 'family-groceries', group_id: 'family' } as Category
    answers.categoryById.set(familyGroceries.id, familyGroceries)
    answers.categoryMappings[groceries.id] = familyGroceries.id

    const familyChequing = { ...CHEQUING, id: 'family-chequing', group_id: 'family' } as AccountsOverview
    const checking = journal.accounts.find((account) => account.rowCount > 0)!
    answers.accountById.set(familyChequing.id, familyChequing)
    answers.accountMappings[checking.id] = familyChequing.id

    expect(buildActualImportPayload(journal, answers).errors).toEqual([
      getImportGroupAccountError(checking.label),
      getImportGroupCategoryError(groceries.label),
    ])
  })

  it('sends a split part an early Actual version gave a long id by the end of that id', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const partId = '0c6a2f4e-9b1d-4e7a-8c3f-5d2e1b0a5e6f'
    const legacyId = `5b0f8e2a-7c4d-4f1b-9e6a-3d2c1b0a1a11/${partId}`
    const legacy = { ...journal, entries: journal.entries.map((entry, index) => (index === 0 ? { ...entry, transactionId: legacyId } : entry)) }
    const build = buildActualImportPayload(legacy, createAnswers(legacy))

    expect(build.errors).toEqual([])
    const sent = build.payload!.rows[0].journal_id
    expect(sent).toHaveLength(JOURNAL_ROW_FIELD_MAX_LENGTHS.journalId)
    expect(sent.endsWith(partId)).toBe(true)
  })

  it('asks for an existing category where a new one\'s name would be too long', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const groceries = journal.categories.find((source) => source.label === 'Groceries')!
    const long = { ...journal, categories: journal.categories.map((source) => (source === groceries ? { ...source, createName: 'G'.repeat(257) } : source)) }

    expect(buildActualImportPayload(long, createAnswers(long)).errors).toEqual([getActualCategoryNameTooLongError(groceries.label)])
  })
})
