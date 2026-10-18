/**
 * Tests compiling the statements of an OFX file and the user's account answers into the upload:
 * what a statement refuses for its currency, which transactions are left out with their reasons,
 * and where money in and out is filed, with a transaction an earlier file already holds skipped
 * only across files, under the same account, currency and bank ID, whatever the files are named
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  CREATE_ACCOUNT_VALUE,
  getImportMerchantTooLongReason,
  getImportNoRowsError,
  JOURNAL_ROW_FIELD_MAX_LENGTHS,
  MAX_IMPORT_NOTES_LENGTH,
  ROW_AMOUNT_TOO_LARGE_REASON,
} from '@/pages/imports/constants'
import {
  getOfxAmountTooPreciseReason,
  getOfxCurrencyMismatchError,
  getOfxFixedAccountCurrencyError,
  getOfxOtherCurrencyReason,
  getOfxRepeatedTransactionReason,
  OFX_AMOUNT_UNREADABLE_REASON,
  OFX_CATEGORIES_UNAVAILABLE_ERROR,
  OFX_DATE_UNREADABLE_REASON,
} from '@/pages/imports/ofx/constants'
import type { OfxFile } from '@/pages/imports/ofx/types'
import {
  buildOfxImportPayload,
  getOfxFixedAccountMappings,
  getOfxStatementsToImport,
  type OfxImportAnswers,
} from '@/pages/imports/ofx/utils/payload'
import { buildOfxPreviewRows } from '@/pages/imports/ofx/utils/preview'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { combineOfxFiles } from '@/pages/imports/ofx/utils/stagedFiles'
import { buildSgmlOfx, toOfxFile, type FixtureStatement } from './fixtures'

const CURRENCIES = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
] as Currency[]

const CHEQUING = { id: 'chequing', name: 'Chequing', currency: 'CAD', can_write: true, is_archived: false, group_id: null } as AccountsOverview
const MISCELLANEOUS = { id: 'misc', name: 'Miscellaneous', kind: 'expense', is_system: true, group_id: null } as Category
const OTHER_INCOME = { id: 'other-income', name: 'Other Income', kind: 'income', is_system: true, group_id: null } as Category

async function readStatements(statements: FixtureStatement[]): Promise<OfxFile> {
  const read = await readOfxFile(toOfxFile(buildSgmlOfx(statements)))
  if (read.status !== 'read') throw new Error(read.reason)
  return read.file
}

function createAnswers(file: OfxFile, choice: string, overrides: Partial<OfxImportAnswers> = {}): OfxImportAnswers {
  return {
    accountMappings: Object.fromEntries(file.statements.map((statement) => [statement.id, choice])),
    accountCreateDetails: Object.fromEntries(
      file.statements.map((statement) => [statement.id, { accountType: statement.proposedType, currency: statement.currency, institutionId: '' }]),
    ),
    accountById: new Map([[CHEQUING.id, CHEQUING]]),
    categories: [MISCELLANEOUS, OTHER_INCOME],
    currencies: CURRENCIES,
    ...overrides,
  }
}

const CHECKING: FixtureStatement = {
  transactions: [
    { posted: '20240115', amount: '-12.50', fitId: 'A1', name: 'Corner Cafe', memo: 'Latte' },
    { posted: '20240116', amount: '2500.00', fitId: 'A2', name: 'Payroll' },
  ],
}

describe('compiling an OFX import', () => {
  it('writes each transaction to its statement account, filing money out and money in under the seeded categories', async () => {
    const file = await readStatements([CHECKING])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.errors).toEqual([])
    expect(build.payload).toEqual({
      accounts: [{ source: file.statements[0].id, account_id: CHEQUING.id }],
      categories: [
        { source: '(no category)', category_id: MISCELLANEOUS.id },
        { source: '(money in, no category)', category_id: OTHER_INCOME.id },
      ],
      merchants: [],
      rows: [
        {
          account_source: file.statements[0].id,
          category_source: '(no category)',
          dt: '2024-01-15',
          amount: '-12.50',
          merchant_name: 'Corner Cafe',
          notes: 'Latte',
          tag_names: [],
        },
        expect.objectContaining({ category_source: '(money in, no category)', dt: '2024-01-16', amount: '2500.00', merchant_name: 'Payroll', notes: null }),
      ],
    })
  })

  it('imports a bank and a credit card statement in one run, each into the account chosen for it', async () => {
    const file = await readStatements([CHECKING, { kind: 'creditCard', transactions: [{ amount: '-30.00', name: 'Hardware' }] }])
    const [bank, card] = file.statements
    const build = buildOfxImportPayload(file, createAnswers(file, CREATE_ACCOUNT_VALUE))

    expect(build.payload?.accounts).toEqual([
      { source: bank.id, create: { name: 'Checking ending 6789', account_type: 'checking', currency: 'CAD', institution_id: null } },
      { source: card.id, create: { name: 'Credit card ending 1111', account_type: 'credit_card', currency: 'CAD', institution_id: null } },
    ])
    expect(build.payload?.rows.map((row) => row.account_source)).toEqual([bank.id, bank.id, card.id])
    expect([...build.writtenSources]).toEqual([bank.id, card.id])
  })

  it('refuses a statement whose currency is not its account\'s, and writes nothing from it', async () => {
    const file = await readStatements([{ ...CHECKING, currency: 'USD' }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))
    const expected = getOfxCurrencyMismatchError(file.statements[0].label, 'USD', 'CAD')

    expect(build.payload).toBeNull()
    expect(build.errors).toEqual([expected])
    expect(build.currencyMismatches).toEqual([expected])
    expect(build.writtenSources.size).toBe(0)
  })

  it('names the account an import started from it was refused for, not a choice the user made', async () => {
    const file = await readStatements([{ ...CHECKING, currency: 'USD' }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id, { fixedAccount: CHEQUING }))

    expect(build.payload).toBeNull()
    expect(build.errors).toEqual([getOfxFixedAccountCurrencyError('USD', 'Chequing', 'CAD')])
  })

  it('writes the one statement of a file to the account an import started from', async () => {
    const file = await readStatements([CHECKING])
    const mappings = getOfxFixedAccountMappings(getOfxStatementsToImport(file), CHEQUING)
    const build = buildOfxImportPayload(file, createAnswers(file, '', { accountMappings: mappings, fixedAccount: CHEQUING }))

    expect(mappings).toEqual({ [file.statements[0].id]: CHEQUING.id })
    expect(build.errors).toEqual([])
    expect(build.payload?.accounts).toEqual([{ source: file.statements[0].id, account_id: CHEQUING.id }])
  })

  it('answers the statement of every file with the account an import started from', async () => {
    const first = await readStatements([CHECKING])
    const second = await readStatements([{ ...CHECKING, kind: 'creditCard' }])
    const file = combineOfxFiles([first, second])
    const mappings = getOfxFixedAccountMappings(getOfxStatementsToImport(file), CHEQUING)

    expect(Object.keys(mappings)).toEqual(file.statements.map((statement) => statement.id))
    expect(Object.values(mappings)).toEqual(file.statements.map(() => CHEQUING.id))
  })

  it('refuses a new account created in a different currency from its statement', async () => {
    const file = await readStatements([{ ...CHECKING, currency: 'USD' }])
    const answers = createAnswers(file, CREATE_ACCOUNT_VALUE)
    answers.accountCreateDetails[file.statements[0].id].currency = 'CAD'

    expect(buildOfxImportPayload(file, answers).currencyMismatches).toHaveLength(1)
  })

  it('refuses the whole import while a statement has no account answer', async () => {
    const file = await readStatements([CHECKING])
    const build = buildOfxImportPayload(file, createAnswers(file, ''))

    expect(build.payload).toBeNull()
    expect(build.currencyMismatches).toEqual([])
  })
})

describe('transactions the import leaves out', () => {
  it('lists a transaction with no readable amount or date with its reason and imports the rest', async () => {
    const file = await readStatements([{
      transactions: [
        { posted: '20240110', amount: 'twelve', name: 'No amount', fitId: '1' },
        { posted: '20240230', amount: '-5.00', name: 'No date', fitId: '2' },
        { posted: '20240111', amount: '-5.00', name: 'Fine', fitId: '3' },
      ],
    }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    // A readable date shows the way the preview groups dates, and an unreadable one stays as the
    // file wrote it so the user can find the line
    expect(build.skippedRows.map(({ payee, reason, amountText, postedLabel }) => ({ payee, reason, amountText, postedLabel }))).toEqual([
      { payee: 'No amount', reason: OFX_AMOUNT_UNREADABLE_REASON, amountText: 'twelve', postedLabel: 'January 10, 2024' },
      { payee: 'No date', reason: OFX_DATE_UNREADABLE_REASON, amountText: '-5.00', postedLabel: '20240230' },
    ])
    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['Fine'])
  })

  it('leaves out an amount with more decimal places than its account\'s currency or too large to store', async () => {
    const yen: FixtureStatement = {
      currency: 'JPY',
      transactions: [
        { amount: '-500.50', name: 'Cents' },
        { amount: '-500', name: 'Whole' },
        { amount: '-99999999999999999999', name: 'Huge' },
      ],
    }
    const file = await readStatements([yen])
    const jpyAccount = { ...CHEQUING, currency: 'JPY' } as AccountsOverview
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id, { accountById: new Map([[jpyAccount.id, jpyAccount]]) }))

    expect(build.skippedRows.map((row) => [row.payee, row.reason])).toEqual([
      ['Cents', getOfxAmountTooPreciseReason('JPY')],
      ['Huge', ROW_AMOUNT_TOO_LARGE_REASON],
    ])
    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['Whole'])
  })

  it('leaves out a memo over the notes limit but keeps one at the limit', async () => {
    const file = await readStatements([{
      transactions: [
        { name: 'At limit', memo: 'm'.repeat(MAX_IMPORT_NOTES_LENGTH) },
        { name: 'Over limit', memo: 'm'.repeat(MAX_IMPORT_NOTES_LENGTH + 1) },
      ],
    }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map((row) => row.payee)).toEqual(['Over limit'])
    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['At limit'])
  })

  it('leaves out a payee name over the merchant limit with the wording the other imports use, but keeps one at the limit', async () => {
    const limit = JOURNAL_ROW_FIELD_MAX_LENGTHS.merchantName
    const file = await readStatements([{
      transactions: [{ name: 'p'.repeat(limit), amount: '-1.00' }, { name: 'p'.repeat(limit + 1), amount: '-2.00' }],
    }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map((row) => row.reason)).toEqual([getImportMerchantTooLongReason(limit + 1)])
    expect(build.payload?.rows).toHaveLength(1)
  })

  // ORIGCURRENCY only records the foreign amount, so a foreign card purchase imports in the statement's currency
  it('leaves out a transaction whose CURRENCY block names another currency, and imports one with an ORIGCURRENCY block', async () => {
    const block = (tag: string, code: string) => `<${tag}>\n<CURRATE>0.75\n<CURSYM>${code}\n</${tag}>\n`
    const file = await readStatements([{
      transactions: [
        { extra: block('CURRENCY', 'USD'), amount: '-1.00', name: 'Priced in dollars' },
        { extra: block('ORIGCURRENCY', 'EUR'), amount: '-2.00', name: 'Bought in euros' },
        { extra: block('CURRENCY', 'CAD'), amount: '-3.00', name: 'Same currency' },
      ],
    }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map((row) => [row.payee, row.reason])).toEqual([
      ['Priced in dollars', getOfxOtherCurrencyReason('USD', 'CAD')],
    ])
    expect(build.payload?.rows.map((row) => [row.merchant_name, row.amount])).toEqual([
      ['Bought in euros', '-2.00'],
      ['Same currency', '-3.00'],
    ])
  })

  it('creates no account for a statement all of whose transactions are left out', async () => {
    const file = await readStatements([CHECKING, { kind: 'creditCard', transactions: [{ amount: 'n/a', name: 'Broken' }] }])
    const build = buildOfxImportPayload(file, createAnswers(file, CREATE_ACCOUNT_VALUE))

    expect(build.payload?.accounts.map((account) => account.source)).toEqual([file.statements[0].id])
    expect([...build.writtenSources]).toEqual([file.statements[0].id])
  })

  it('refuses an import with nothing left to write', async () => {
    const file = await readStatements([{ transactions: [{ amount: 'n/a' }] }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.payload).toBeNull()
    expect(build.errors).toEqual([getImportNoRowsError('file')])
  })
})

describe('categories for a statement', () => {
  it('refuses the import when a seeded category it files under cannot be found', async () => {
    const file = await readStatements([CHECKING])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id, { categories: [MISCELLANEOUS] }))

    expect(build.payload).toBeNull()
    expect(build.errors).toEqual([OFX_CATEGORIES_UNAVAILABLE_ERROR])
  })

  it('asks for only the categories the written rows use', async () => {
    const file = await readStatements([{ transactions: [{ amount: '-4.00' }] }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id, { categories: [MISCELLANEOUS] }))

    expect(build.errors).toEqual([])
    expect(build.payload?.categories).toEqual([{ source: '(no category)', category_id: MISCELLANEOUS.id }])
  })
})

describe('previewing an OFX import', () => {
  it('shows the transactions the commit writes, leaving out those it skips and statements in the wrong currency', async () => {
    const file = await readStatements([
      { transactions: [{ amount: 'bad', name: 'Skipped' }, { amount: '-1.00', name: 'Shown' }] },
      { kind: 'creditCard', currency: 'USD', transactions: [{ amount: '-2.00', name: 'Wrong currency' }] },
    ])
    const answers = createAnswers(file, CHEQUING.id)
    const build = buildOfxImportPayload(file, answers)

    const rows = buildOfxPreviewRows(file, {
      ...answers,
      institutionById: new Map(),
      skippedRowIds: new Set(build.skippedRows.map((row) => row.id)),
    }, 5)

    expect(rows.map((row) => row.transaction.merchant_name)).toEqual(['Shown'])
    expect(rows[0].category?.name).toBe('Miscellaneous')
  })
})

// Monthly statements overlap by a few days, so one bank transaction ID can be in two files. The
// import keeps the first copy it meets in the order of the files
describe('a transaction that an earlier file of the import already holds', () => {
  async function readFiles(files: Array<{ name: string; statements: FixtureStatement[] }>) {
    const read = await Promise.all(files.map(async ({ name, statements }) => {
      const result = await readOfxFile(toOfxFile(buildSgmlOfx(statements), name))
      if (result.status !== 'read') throw new Error(result.reason)
      return result.file
    }))
    return combineOfxFiles(read)
  }

  const january = { name: '2024-01.qfx', statements: [{ transactions: [
    { posted: '20240130', amount: '-10.00', fitId: 'A1', name: 'Cafe' },
    { posted: '20240131', amount: '-20.00', fitId: 'A2', name: 'Market' },
  ] }] }
  const february = { name: '2024-02.qfx', statements: [{ transactions: [
    { posted: '20240131', amount: '-20.00', fitId: 'A2', name: 'Market' },
    { posted: '20240201', amount: '-30.00', fitId: 'B1', name: 'Gas' },
  ] }] }

  it('is skipped with the name of the file that has it, and the first copy is kept', async () => {
    const file = await readFiles([january, february])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['Cafe', 'Market', 'Gas'])
    expect(build.skippedRows.map(({ payee, reason, fileName }) => ({ payee, reason, fileName }))).toEqual([
      { payee: 'Market', reason: getOfxRepeatedTransactionReason('2024-01.qfx'), fileName: '2024-02.qfx' },
    ])
    expect(getOfxRepeatedTransactionReason('2024-01.qfx')).toBe('This transaction is already in 2024-01.qfx.')
  })

  it('names the first file that has it, not the nearest, when later files repeat it too', async () => {
    const march = { name: '2024-03.qfx', statements: february.statements }
    const file = await readFiles([january, february, march])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map(({ fileName, payee, reason }) => [fileName, payee, reason])).toEqual([
      ['2024-02.qfx', 'Market', getOfxRepeatedTransactionReason('2024-01.qfx')],
      ['2024-03.qfx', 'Market', getOfxRepeatedTransactionReason('2024-01.qfx')],
      ['2024-03.qfx', 'Gas', getOfxRepeatedTransactionReason('2024-02.qfx')],
    ])
  })

  // Many banks name every download the same, so the files are told apart by the files and not by their names
  it('is skipped when the files share a name, which the reason and the skipped row tell apart by position', async () => {
    const file = await readFiles([{ ...january, name: 'statement.qfx' }, { ...february, name: 'statement.qfx' }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['Cafe', 'Market', 'Gas'])
    expect(build.skippedRows.map(({ fileName, reason }) => [fileName, reason])).toEqual([
      ['statement.qfx (file 2)', getOfxRepeatedTransactionReason('statement.qfx (file 1)')],
    ])
  })

  // A file that holds one account as two statements, such as split over two date ranges, gives the
  // second the suffix #2, though both are for the same bank account
  it('is skipped when an earlier file holds it under the same account in another of its statements', async () => {
    const month = (name: string, fitId: string) => ({ transactions: [{ posted: '20240110', amount: '-5.00', fitId, name }] })
    const file = await readFiles([
      { name: 'a.qfx', statements: [month('Jan', 'J1'), month('Feb', 'F1')] },
      { name: 'b.qfx', statements: [month('Feb', 'F1'), month('Mar', 'M1')] },
    ])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map(({ fileName, payee, reason }) => [fileName, payee, reason])).toEqual([
      ['b.qfx', 'Feb', getOfxRepeatedTransactionReason('a.qfx')],
    ])
    expect(build.payload?.rows.map((row) => row.merchant_name).sort()).toEqual(['Feb', 'Jan', 'Mar'])
  })

  it('leaves a name as it is while no other file has it', async () => {
    const file = await readFiles([{ ...january, name: 'statement.qfx' }, february])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map(({ fileName, reason }) => [fileName, reason])).toEqual([
      ['2024-02.qfx', getOfxRepeatedTransactionReason('statement.qfx')],
    ])
  })

  it('is imported when the same account ID and ID are in a file in another currency', async () => {
    const usdAccount = { ...CHEQUING, id: 'usd-chequing', currency: 'USD' } as AccountsOverview
    const inUsd = { name: '2024-02.qfx', statements: [{ currency: 'USD', transactions: february.statements[0].transactions }] }
    const file = await readFiles([january, inUsd])
    const answers = createAnswers(file, CHEQUING.id, {
      accountById: new Map([[CHEQUING.id, CHEQUING], [usdAccount.id, usdAccount]]),
    })
    answers.accountMappings = Object.fromEntries(file.statements.map((statement) => [statement.id, statement.currency === 'USD' ? usdAccount.id : CHEQUING.id]))
    const build = buildOfxImportPayload(file, answers)

    expect(build.errors).toEqual([])
    expect(build.skippedRows).toEqual([])
    expect(build.payload?.rows).toHaveLength(4)
  })

  it('leaves the preview without it', async () => {
    const file = await readFiles([january, february])
    const answers = createAnswers(file, CHEQUING.id)
    const build = buildOfxImportPayload(file, answers)

    const rows = buildOfxPreviewRows(file, {
      ...answers,
      institutionById: new Map(),
      skippedRowIds: new Set(build.skippedRows.map((row) => row.id)),
    }, 10)

    expect(rows.map((row) => row.transaction.merchant_name)).toEqual(['Cafe', 'Market', 'Gas'])
  })

  it('is imported when the same ID repeats within one file, which the bank gave twice', async () => {
    const file = await readFiles([{ name: '2024-01.qfx', statements: [{ transactions: [
      { posted: '20240110', amount: '-5.00', fitId: '0', name: 'First' },
      { posted: '20240111', amount: '-6.00', fitId: '0', name: 'Second' },
    ] }] }])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows).toEqual([])
    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['First', 'Second'])
  })

  it('is imported when the same ID belongs to another bank account', async () => {
    const other = { name: '2024-02.qfx', statements: [{ accountId: '000999888777', transactions: february.statements[0].transactions }] }
    const file = await readFiles([january, other])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows).toEqual([])
    expect(build.payload?.rows).toHaveLength(4)
  })

  it('is imported when the bank gave it no ID', async () => {
    const withoutId = (name: string) => ({ name, statements: [{ transactions: [{ posted: '20240110', amount: '-5.00', fitId: null, name: 'Cafe' }] }] })
    const file = await readFiles([withoutId('2024-01.qfx'), withoutId('2024-02.qfx')])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows).toEqual([])
    expect(build.payload?.rows).toHaveLength(2)
  })

  it('does not count a first copy that was itself left out, so a readable copy in a later file is imported', async () => {
    const unreadable = { name: '2024-01.qfx', statements: [{ transactions: [{ posted: '20240131', amount: 'n/a', fitId: 'A2', name: 'Market' }] }] }
    const file = await readFiles([unreadable, february])
    const build = buildOfxImportPayload(file, createAnswers(file, CHEQUING.id))

    expect(build.skippedRows.map((row) => row.reason)).toEqual([OFX_AMOUNT_UNREADABLE_REASON])
    expect(build.payload?.rows.map((row) => row.merchant_name)).toEqual(['Market', 'Gas'])
  })
})
