/**
 * Tests compiling a normalised Actual Budget export and the user's answers into the upload
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  getActualAmountPrecisionReason,
  getActualCategoryCreateClashError,
  getActualMixedCurrencyError,
  getActualSharedAccountError,
  getActualTransferCategoryError,
} from '@/pages/imports/actual/constants'
import type { ActualJournal } from '@/pages/imports/actual/types'
import { buildActualImportPayload, type ActualImportAnswers } from '@/pages/imports/actual/utils/payload'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  getCategoryDirectionClashError,
  getImportAccountCurrencyRequiredError,
  getImportAccountMappingError,
  getImportReadOnlyAccountMappingError,
} from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { normaliseActualFixture } from './fixtures'

const CURRENCIES = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
] as Currency[]

const CHEQUING = { id: 'chequing', name: 'Chequing', currency: 'CAD', can_write: true, is_archived: false } as AccountsOverview
const ARCHIVED = { id: 'old-savings', name: 'Old Savings', currency: 'CAD', can_write: true, is_archived: true } as AccountsOverview
const GROCERIES = { id: 'groceries', name: 'Groceries', kind: 'expense', group_id: null } as Category
const CAR_INCOME = { id: 'car-income', name: 'Car', kind: 'income', group_id: null } as Category

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
    categoryById: new Map([[GROCERIES.id, GROCERIES]]),
    currencies: CURRENCIES,
    budgetCategorySources: new Set(),
  }
}

function findAccountId(journal: ActualJournal, name: string) {
  const account = journal.accounts.find((candidate) => candidate.name === name)
  if (!account) throw new Error(`No account named ${name}`)
  return account.id
}

describe('Actual Budget import payload', () => {
  it('uploads every row, with loan payments categorised on the budget side and closed accounts archived', async () => {
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

  it('writes yen rows in whole yen', async () => {
    const { journal } = await normaliseActualFixture('yen')
    const build = buildActualImportPayload(journal, createAnswers(journal, 'JPY'))

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
      getActualCategoryCreateClashError('Gym', 'Gym (Twin)'),
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
    const answers = { ...createAnswers(withUnused), budgetCategorySources: new Set([car.id, `transfer:${car.categoryId}`, 'unused']) }

    const build = buildActualImportPayload(withUnused, answers)
    expect(build.errors).toEqual([])
    expect(build.payload?.categories.some((mapping) => mapping.source === 'unused')).toBe(false)
    expect(build.budgetCategoryMappings.map((mapping) => mapping.source)).toEqual([car.id, `transfer:${car.categoryId}`, 'unused'])
  })
})
