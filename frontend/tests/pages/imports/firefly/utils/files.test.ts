/**
 * Tests Firefly III file validation through the real CSV reader so header detection cannot silently
 * turn an export's first row into data or discard it
 *
 * Fixtures write cells the way Firefly III does, with an apostrophe in front of any value starting
 * with one of the characters league/csv escapes, which is every withdrawal amount
 */
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import {
  FIREFLY_BUDGETS_REQUIRED_HEADERS,
  FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
} from '@/pages/imports/firefly/constants'
import { readFireflyCsvFile } from '@/pages/imports/firefly/utils/files'
import { resolveFireflyRowLegs } from '@/pages/imports/firefly/utils/rowResolution'
import { processImportFileIntake } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])
const TRANSACTIONS_CSV = `${FIREFLY_TRANSACTIONS_REQUIRED_HEADERS.join(',')}\n1,withdrawal,'-12.34,CAD,2026-04-11,Main Chequing,Asset account,Corner Grocer,Expense account\n`
const BUDGETS_CSV = `${FIREFLY_BUDGETS_REQUIRED_HEADERS.join(',')}\n`

function readFile(csv: string, kind: 'transactions' | 'budgets') {
  return readFireflyCsvFile(new File([csv], `${kind}.csv`), kind, SUPPORTED_CURRENCY_CODES)
}

describe('reading Firefly III export files', () => {
  it('accepts a transactions export carrying every required header', async () => {
    const headers = FIREFLY_TRANSACTIONS_REQUIRED_HEADERS.join(',')
    const row = "1,withdrawal,'-12.34,CAD,2026-04-11,Main Chequing,Asset account,Corner Grocer,Expense account"

    const draft = await readFile(`${headers}\n${row}\n`, 'transactions')

    expect(draft.error).toBeNull()
    expect(draft.hasHeaderRow).toBe(true)
    expect(draft.rows).toHaveLength(1)
    expect(draft.rows[0].amount).toBe('-12.34')
  })

  it('reports a missing required transactions header', async () => {
    const headers = FIREFLY_TRANSACTIONS_REQUIRED_HEADERS.filter((header) => header !== 'destination_type')
    const row = "1,withdrawal,'-12.34,CAD,2026-04-11,Main Chequing,Asset account,Corner Grocer"

    const draft = await readFile(`${headers.join(',')}\n${row}\n`, 'transactions')

    expect(draft.error).toContain('missing columns: destination_type')
  })

  it('accepts a budgets export with only its required headers', async () => {
    const draft = await readFile(`${FIREFLY_BUDGETS_REQUIRED_HEADERS.join(',')}\n`, 'budgets')

    expect(draft.error).toBeNull()
    expect(draft.hasHeaderRow).toBe(true)
    expect(draft.rows).toHaveLength(0)
  })
})

describe('removing the formula escape from Firefly III cells', () => {
  const HEADERS = [
    'journal_id', 'type', 'amount', 'currency_code', 'foreign_amount', 'foreign_currency_code', 'date',
    'description', 'source_name', 'source_type', 'destination_name', 'destination_type', 'category', 'tags',
  ].join(',')

  const CURRENCIES: Currency[] = [
    { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
    { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  ]

  const chequing: AccountsOverview = {
    id: 'checking',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Chequing',
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
  }

  const resolutionOptions = {
    accountById: new Map([[chequing.id, chequing]]),
    accountMappings: { Chequing: chequing.id },
    accountCreateDetails: {},
    institutionById: new Map(),
    categoryById: new Map(),
    categoryMappings: {},
    categoryCreateKinds: {},
    transferCategory: undefined,
    balanceAdjustmentCategory: undefined,
    currencies: CURRENCIES,
  }

  it('reads withdrawals, negative foreign amounts and negative opening balances as the right amount and direction', async () => {
    const csv = [
      HEADERS,
      "1,Withdrawal,'-42.10,CAD,,,2026-04-11,Groceries,Chequing,Asset account,Corner Grocer,Expense account,,",
      "2,Withdrawal,'-15.00,USD,'-19.99,CAD,2026-04-12,Streaming,Chequing,Asset account,Streamflix,Expense account,,",
      "3,Opening balance,'-500.00,CAD,,,2026-01-01,Initial balance,Chequing,Asset account,Initial balance for Chequing,Initial balance account,,",
    ].join('\n')

    const draft = await readFile(csv, 'transactions')

    expect(draft.error).toBeNull()
    expect(draft.rows.map((row) => [row.amount, row.foreign_amount])).toEqual([
      ['-42.10', ''],
      ['-15.00', '-19.99'],
      ['-500.00', ''],
    ])
    expect(draft.rows.map((row) => resolveFireflyRowLegs(row, resolutionOptions).legs?.map((leg) => leg.amount)))
      .toEqual([[-4210], [-1999], [-50000]])
  })

  it('removes the escape from text cells', async () => {
    const csv = [
      HEADERS,
      "1,Withdrawal,'-5.00,CAD,,,2026-04-11,'=Refund owed,Chequing,Asset account,'+Plus Market,Expense account,'-Misc,'@home",
      `2,Withdrawal,'-5.00,CAD,,,2026-04-12,"'\tTabbed","'\rChequing",Asset account,Corner Grocer,Expense account,,`,
    ].join('\n')

    const draft = await readFile(csv, 'transactions')

    expect(draft.error).toBeNull()
    expect(draft.rows[0]).toMatchObject({
      description: '=Refund owed',
      destination_name: '+Plus Market',
      category: '-Misc',
      tags: '@home',
    })
    expect(draft.rows[1]).toMatchObject({ description: 'Tabbed', source_name: 'Chequing' })
  })

  // The reader trims every cell, so removing the escape after trimming would leave a lone apostrophe
  // behind where the escaped value was nothing but whitespace
  it('reads an escaped cell holding only whitespace as empty', async () => {
    const csv = [
      HEADERS,
      `1,Withdrawal,'-5.00,CAD,,,2026-04-11,"'\t",Chequing,Asset account,Corner Grocer,Expense account,"'\r\n",`,
    ].join('\n')

    const draft = await readFile(csv, 'transactions')

    expect(draft.error).toBeNull()
    expect(draft.rows[0]).toMatchObject({ description: '', category: '' })
  })

  it('keeps an apostrophe that is not in front of a character the export escapes', async () => {
    const csv = [
      HEADERS,
      "1,Withdrawal,'-5.00,CAD,,,2026-04-11,'Tis the season,Chequing,Asset account,O'Brien's,Expense account,',",
    ].join('\n')

    const draft = await readFile(csv, 'transactions')

    expect(draft.error).toBeNull()
    expect(draft.rows[0]).toMatchObject({ description: "'Tis the season", destination_name: "O'Brien's", category: "'" })
  })

  it('removes the escape from the budgets export', async () => {
    const csv = `${FIREFLY_BUDGETS_REQUIRED_HEADERS.join(',')}\n'@Home,1,2026-06-01,2026-06-30,CAD,300.00\n`

    const draft = await readFile(csv, 'budgets')

    expect(draft.error).toBeNull()
    expect(draft.rows[0]).toMatchObject({ name: '@Home', amount: '300.00' })
  })
})

describe('delegating selected Firefly files to their supplied slot', () => {
  it('passes a transactions CSV to the transactions reader', async () => {
    const file = new File([TRANSACTIONS_CSV], 'transactions.csv', { type: 'text/csv' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'transactions', SUPPORTED_CURRENCY_CODES)
    ))

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })

    expect(readFile).toHaveBeenCalledWith(file)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toBeNull()
    expect(result.result.rows).toHaveLength(1)
  })

  it('passes a budgets CSV to the budgets reader', async () => {
    const file = new File([BUDGETS_CSV], 'budgets.csv', { type: 'text/csv' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'budgets', SUPPORTED_CURRENCY_CODES)
    ))

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })

    expect(readFile).toHaveBeenCalledWith(file)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toBeNull()
    expect(result.result.rows).toEqual([])
  })

  it('keeps the supplied slot authoritative over file contents', async () => {
    const file = new File([TRANSACTIONS_CSV], 'transactions.csv', { type: 'text/csv' })

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile: (selectedFile) => readFireflyCsvFile(selectedFile, 'budgets', SUPPORTED_CURRENCY_CODES),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toContain('missing columns: name, active, start_date')
  })

  it('refuses a non-CSV file before invoking the Firefly reader', async () => {
    const file = new File([TRANSACTIONS_CSV], 'image.png', { type: 'image/png' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'transactions', SUPPORTED_CURRENCY_CODES)
    ))

    expect(await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose a CSV file.' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('refuses multiple files before invoking either slot reader', async () => {
    const first = new File([TRANSACTIONS_CSV], 'first.csv', { type: 'text/csv' })
    const second = new File([TRANSACTIONS_CSV], 'second.csv', { type: 'text/csv' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'transactions', SUPPORTED_CURRENCY_CODES)
    ))

    expect(await processImportFileIntake({
      files: [first, second],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose one CSV file at a time.' })
    expect(readFile).not.toHaveBeenCalled()
  })
})
