/**
 * Tests the ledger preview of an Actual Budget import, which applies the answers the way the commit does
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { ActualJournal } from '@/pages/imports/actual/types'
import { applyActualCreditPayments } from '@/pages/imports/actual/utils/categories'
import { buildActualPreviewRows, type ActualPreviewOptions } from '@/pages/imports/actual/utils/preview'
import { fileActualPaymentsInCategory, normaliseActualFixture } from './fixtures'

const CURRENCIES = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
] as Currency[]
const TRANSFER = { id: 'transfer', name: 'Transfer', kind: 'transfer', is_system: true } as Category
const BALANCE_ADJUSTMENT = { id: 'balance', name: 'Balance Adjustment', kind: 'transfer', is_system: true } as Category

function createOptions(journal: ActualJournal, currency: string): ActualPreviewOptions {
  return {
    accountMappings: Object.fromEntries(journal.accounts.map((account) => [account.id, CREATE_ACCOUNT_VALUE])),
    accountCreateDetails: Object.fromEntries(journal.accounts.map((account) => [account.id, { accountType: 'checking', currency, institutionId: '' }])),
    accountById: new Map(),
    institutionById: new Map(),
    categoryMappings: Object.fromEntries(journal.categories.map((source) => [source.id, CREATE_CATEGORY_VALUE])),
    categoryCreateKinds: Object.fromEntries(journal.categories.map((source) => [source.id, source.role === 'transfer' ? 'transfer' : 'expense'])),
    categoryById: new Map(),
    transferCategory: TRANSFER,
    balanceAdjustmentCategory: BALANCE_ADJUSTMENT,
    currencies: CURRENCIES,
    skippedTransactionIds: new Set(),
  }
}

describe('Actual Budget import preview', () => {
  it('shows a loan payment kept as a transfer categorised on the budget side only', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const payment = journal.entries.find((entry) => entry.date === '2026-07-05')!
    const rows = buildActualPreviewRows({ ...journal, entries: [payment] }, createOptions(journal, 'CAD'), 5)

    expect(rows.map((row) => [row.accountName, row.transaction.amount, row.category?.name, row.counterpartyAccountName])).toEqual([
      ['Checking', -30000, 'Car Transfers', 'Car Loan'],
      ['Car Loan', 30000, 'Transfer', 'Checking'],
    ])
    expect(rows[0].transaction.counterparty_account_scope).toBe('tracked')
  })

  it('shows a loan payment filed as spending with the loan as its merchant and no other account', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const effective = fileActualPaymentsInCategory(journal)
    const payment = effective.entries.find((entry) => entry.date === '2026-07-05')!
    const rows = buildActualPreviewRows({ ...effective, entries: [payment] }, createOptions(effective, 'CAD'), 5)

    expect(rows.map((row) => [
      row.accountName,
      row.transaction.amount,
      row.category?.name,
      row.transaction.merchant_name,
      row.counterpartyAccountName,
      row.transaction.counterparty_account_scope,
    ])).toEqual([
      ['Checking', -30000, 'Car', 'Car Loan', undefined, null],
      ['Car Loan', 30000, 'Transfer', null, 'Checking', 'tracked'],
    ])
  })

  it('shows a credit card payment under its category on both legs, each naming the other account', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const payment = journal.entries.find((entry) => entry.date === '2026-07-05')!
    const credit = applyActualCreditPayments({ ...journal, entries: [{ ...payment, categorySourceId: null, categoryLeg: null }] }, new Set([payment.destinationAccountId!]))
    const rows = buildActualPreviewRows(credit, createOptions(credit, 'CAD'), 5)

    expect(rows.map((row) => [row.accountName, row.transaction.amount, row.category?.name, row.counterpartyAccountName])).toEqual([
      ['Checking', -30000, 'Credit Card Payment', 'Car Loan'],
      ['Car Loan', 30000, 'Credit Card Payment', 'Checking'],
    ])
  })

  it('writes opening balances as balance adjustments and yen in whole yen', async () => {
    const { journal } = await normaliseActualFixture('yen')
    const rows = buildActualPreviewRows(journal, createOptions(journal, 'JPY'), 50)

    const opening = journal.entries.find((entry) => entry.type === 'opening balance')!
    const openingRow = rows.find((row) => row.id === `actual-preview-${opening.transactionId}-0`)
    expect(openingRow?.category).toBe(BALANCE_ADJUSTMENT)
    expect(openingRow?.transaction.amount).toBe(opening.amount / 100)
    const lawson = rows.find((row) => row.transaction.merchant_name === 'Lawson')
    expect(lawson?.transaction.amount).toBe(-4580)
  })

  it('leaves out rows waiting on an account answer and rows the upload skips', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const options = createOptions(journal, 'CAD')
    const checking = journal.accounts.find((account) => account.name === 'Checking')!
    delete options.accountMappings[checking.id]
    const firstOther = journal.entries.find((entry) => ![entry.sourceAccountId, entry.destinationAccountId].includes(checking.id))!
    options.skippedTransactionIds = new Set([firstOther.transactionId])

    const rows = buildActualPreviewRows(journal, options, 500)
    expect(rows.some((row) => row.accountName === 'Checking')).toBe(false)
    expect(rows.some((row) => row.id.startsWith(`actual-preview-${firstOther.transactionId}-`))).toBe(false)
  })
})
