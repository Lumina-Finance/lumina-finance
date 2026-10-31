/**
 * Tests a QIF file through the shared statement import: the amounts written are the file's own, to the
 * cent, with no bank ID since QIF states none, so a re-import is not recognised, and every transaction
 * the file cannot state exactly is listed as skipped with its reason instead of being written
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { QIF_AMOUNTS_DIFFER_REASON, QIF_TWO_DIGIT_YEAR_REASON } from '@/pages/imports/qif/constants'
import { OFX_DATE_UNREADABLE_REASON } from '@/pages/imports/ofx/constants'
import type { OfxReadings } from '@/pages/imports/ofx/types'
import { buildOfxImportPayload } from '@/pages/imports/ofx/utils/payload'
import { buildOfxPreviewRows } from '@/pages/imports/ofx/utils/preview'
import { QIF_EXPECTATIONS } from '@/pages/imports/qif/expectations'
import { readQifFile } from '@/pages/imports/qif/utils/readFile'
import { resolveQifFile } from '@/pages/imports/qif/utils/readings'
import { toQifFile } from './fixtures'

const CURRENCIES = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
] as Currency[]
const CHEQUING = {
  id: 'chequing',
  name: 'Chequing',
  currency: 'CAD',
  can_write: true,
  is_archived: false,
  group_id: null,
} as AccountsOverview
const YEN = {
  id: 'yen',
  name: 'Yen',
  currency: 'JPY',
  can_write: true,
  is_archived: false,
  group_id: null,
} as AccountsOverview
const MISCELLANEOUS = {
  id: 'misc',
  name: 'Miscellaneous',
  kind: 'expense',
  is_system: true,
  group_id: null,
} as Category
const OTHER_INCOME = {
  id: 'other-income',
  name: 'Other Income',
  kind: 'income',
  is_system: true,
  group_id: null,
} as Category
const READINGS: OfxReadings = {
  dateFormat: 'monthFirst',
  amountFormat: { decimalSeparator: '.', groupingSeparator: ',' },
}

const QIF = [
  '!Type:Bank',
  'D1/2/2024',
  'T-1,234.50',
  'PLandlord',
  '^',
  "D1/3'24",
  'T2,000.00',
  'U2,000.00',
  '^',
  'D01/04/24',
  'T-5.00',
  '^',
  'D1/5/2024',
  'T-5.00',
  'U-6.00',
  '^',
  'D1/6/2024',
  'T-100.00',
  'SFood',
  '$-60.00',
  'SGas',
  '$-40.00',
  '^',
  'D1/7/2024',
  'T-100.00',
  'SFood',
  '$-60.00',
  'SGas',
  '$-39.00',
  '^',
  'D1/8/2024',
  'PNo amount',
  '^',
].join('\n')

async function build(account: AccountsOverview = CHEQUING) {
  const read = await readQifFile(toQifFile(QIF), 'file-1')
  if (read.status !== 'read') throw new Error(read.reason)
  const file = resolveQifFile(read.file, READINGS)
  const statement = file.statements[0]
  const answers = {
    accountMappings: { [statement.id]: account.id },
    accountCreateDetails: {},
    accountById: new Map([[account.id, account]]),
    categories: [MISCELLANEOUS, OTHER_INCOME],
    currencies: CURRENCIES,
  }
  return { file, answers, build: buildOfxImportPayload(file, answers) }
}

describe('a QIF file through the statement import', () => {
  it("writes the file's own amounts and dates, summing a split to its total, with no bank ID", async () => {
    const { build: result } = await build()

    expect(result.errors).toEqual([])
    expect(result.payload?.rows.map(({ dt, amount }) => [dt, amount])).toEqual([
      ['2024-01-02', '-1234.50'],
      ['2024-01-03', '2000.00'],
      ['2024-01-06', '-100.00'],
    ])
    expect(result.payload?.rows.every((row) => row.bank_account === null && row.bank_transaction === null)).toBe(true)
    expect(result.payload?.rows.map((row) => row.category_source)).toEqual([
      '(no category)',
      '(money in, no category)',
      '(no category)',
    ])
  })

  // Quicken writes an account's opening balance as a transaction, which this import brings in like
  // any other, so the card tells the person not to add the same amount as an opening balance too
  it("brings Quicken's Opening Balance record in as an ordinary income transaction", async () => {
    const read = await readQifFile(
      toQifFile(['!Type:Bank', 'D1/2/2024', 'T1,000.00', 'POpening Balance', 'L[Chequing]', '^'].join('\n')),
      'file-1',
    )
    if (read.status !== 'read') throw new Error(read.reason)
    const file = resolveQifFile(read.file, READINGS)
    const result = buildOfxImportPayload(file, {
      accountMappings: { [file.statements[0].id]: CHEQUING.id },
      accountCreateDetails: {},
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      categories: [MISCELLANEOUS, OTHER_INCOME],
      currencies: CURRENCIES,
    })

    expect(result.payload?.rows).toMatchObject([
      { amount: '1000.00', merchant_name: 'Opening Balance', category_source: '(money in, no category)' },
    ])
    expect(QIF_EXPECTATIONS.changes.find((change) => change.source === 'An account')?.lumina).toContain(
      'Opening Balance transaction in the file comes in like any other',
    )
  })

  it('lists what it cannot state exactly as skipped, each with its reason, and writes none of them', async () => {
    const { build: result } = await build()

    expect(result.skippedRows.map(({ amountText, reason }) => [amountText, reason])).toEqual([
      ['-5.00', QIF_TWO_DIGIT_YEAR_REASON],
      ['-5.00', QIF_AMOUNTS_DIFFER_REASON],
      ['-100.00', expect.stringContaining('-100.00')],
      ['', expect.any(String)],
    ])
  })

  it('takes the currency of the account the file is matched to, and skips an amount that account cannot hold', async () => {
    const { build: result } = await build(YEN)

    expect(result.currencyMismatches).toEqual([])
    expect(result.payload?.rows.map(({ amount }) => amount)).toEqual(['2000.00', '-100.00'])
    expect(result.skippedRows.some(({ amountText }) => amountText === '-1,234.50')).toBe(true)
  })

  it('leaves the same rows when imported again, so a re-import adds them a second time', async () => {
    const first = (await build()).build.payload?.rows
    const second = (await build()).build.payload?.rows

    expect(second).toEqual(first)
  })

  it("previews only the transactions it will write, in the units of the account's currency", async () => {
    const { file, answers, build: result } = await build()
    const skippedRowIds = new Set(result.skippedRows.map((row) => row.id))
    const preview = (account: AccountsOverview) =>
      buildOfxPreviewRows(
        file,
        {
          ...answers,
          accountMappings: { [file.statements[0].id]: account.id },
          accountById: new Map([[account.id, account]]),
          institutionById: new Map(),
          skippedRowIds,
        },
        10,
      ).map((row) => row.transaction.amount)

    expect(preview(CHEQUING)).toEqual([-123450n, 200000n, -10000n])
  })

  it('skips every transaction with the date reason while no date format is chosen', async () => {
    const read = await readQifFile(toQifFile(QIF), 'file-1')
    if (read.status !== 'read') throw new Error(read.reason)
    const file = resolveQifFile(read.file, { ...READINGS, dateFormat: null })
    const statement = file.statements[0]
    const result = buildOfxImportPayload(file, {
      accountMappings: { [statement.id]: CHEQUING.id },
      accountCreateDetails: {},
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      categories: [MISCELLANEOUS, OTHER_INCOME],
      currencies: CURRENCIES,
    })

    expect(result.skippedRows.some(({ reason }) => reason === OFX_DATE_UNREADABLE_REASON)).toBe(true)
  })
})
