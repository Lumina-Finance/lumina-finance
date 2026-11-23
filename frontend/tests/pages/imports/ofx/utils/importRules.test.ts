/**
 * Tests the rows an OFX or QIF import asks the import rules about, the rows the save would send,
 * and what the preview shows of the rules' answer
 *
 * These tests catch the rules being asked about rows other than the ones an OFX or QIF save would
 * send, a payee not read as the description the rules match, and a preview that shows the file's
 * values where the save would write the rules'
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { OfxFile } from '@/pages/imports/ofx/types'
import { buildOfxImportPayload, getOfxSkippedRowId, type OfxImportAnswers } from '@/pages/imports/ofx/utils/payload'
import { buildOfxPreviewRows } from '@/pages/imports/ofx/utils/preview'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { buildSgmlOfx, toOfxFile, type FixtureStatement } from './fixtures'

const CURRENCIES = [{ id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 }] as Currency[]
const CHEQUING = {
  id: 'chequing',
  name: 'Chequing',
  currency: 'CAD',
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
const DINING = { id: 'dining', name: 'Dining', kind: 'expense', is_system: false, group_id: null } as Category
const RULE = { id: 'rule-1', name: 'Coffee' }

const STATEMENT: FixtureStatement = {
  transactions: [
    { posted: '20240115', amount: '-12.50', fitId: 'A1', name: 'Corner Cafe', memo: 'Latte' },
    { posted: '20240116', amount: '2500.00', fitId: 'A2', name: 'Payroll' },
  ],
}

async function read(statement: FixtureStatement = STATEMENT): Promise<OfxFile> {
  const result = await readOfxFile(toOfxFile(buildSgmlOfx([statement])))
  if (result.status !== 'read') throw new Error(result.reason)
  return result.file
}

function answers(file: OfxFile, choice: string, overrides: Partial<OfxImportAnswers> = {}): OfxImportAnswers {
  return {
    accountMappings: Object.fromEntries(file.statements.map((statement) => [statement.id, choice])),
    accountCreateDetails: Object.fromEntries(
      file.statements.map((statement) => [
        statement.id,
        { accountType: statement.proposedType, currency: statement.currency ?? '', institutionId: '' },
      ]),
    ),
    accountById: new Map([[CHEQUING.id, CHEQUING]]),
    categories: [MISCELLANEOUS, OTHER_INCOME, DINING],
    currencies: CURRENCIES,
    ...overrides,
  }
}

describe('the rows asked of the import rules in an OFX import', () => {
  it('are the rows the save sends, never a transfer, with the statement account', async () => {
    const file = await read()
    const build = buildOfxImportPayload(file, answers(file, CHEQUING.id))

    expect(build.ruleRows).toEqual([
      {
        id: getOfxSkippedRowId(file.statements[0], file.statements[0].transactions[0]),
        request: {
          description: 'Corner Cafe',
          note: 'Latte',
          amount: '-12.50',
          currency: 'CAD',
          account_id: CHEQUING.id,
          is_transfer: false,
          tag_names: [],
        },
      },
      expect.objectContaining({ request: expect.objectContaining({ description: 'Payroll', amount: '2500.00' }) }),
    ])
  })

  it('name no account for one the import creates', async () => {
    const file = await read()
    const build = buildOfxImportPayload(file, answers(file, CREATE_ACCOUNT_VALUE))
    expect(build.ruleRows.map((row) => row.request.account_id)).toEqual([null, null])
  })

  it('leave out a row the account already holds', async () => {
    const file = await read()
    const [statement] = file.statements
    const held = new Set([getOfxSkippedRowId(statement, statement.transactions[0])])
    const build = buildOfxImportPayload(file, answers(file, CHEQUING.id, { heldRowIds: held }))

    expect(build.ruleRows.map((row) => row.request.description)).toEqual(['Payroll'])
    expect(build.payload?.rows).toHaveLength(1)
  })

  it('are empty while the answers leave the payload unbuilt', async () => {
    const file = await read()
    // The rows are read and the categories still loading, so the build refuses with rows in hand
    const build = buildOfxImportPayload(file, answers(file, CHEQUING.id, { categories: undefined }))
    expect(build.payload).toBeNull()
    expect(build.ruleRows).toEqual([])
  })
})

describe('the preview of an OFX import under import rules', () => {
  it("shows the merchant, category and tags a rule gives in place of the statement's", async () => {
    const file = await read()
    const [statement] = file.statements
    const rowId = getOfxSkippedRowId(statement, statement.transactions[0])
    const rows = buildOfxPreviewRows(
      file,
      {
        accountMappings: { [statement.id]: CHEQUING.id },
        accountCreateDetails: {},
        accountById: new Map([[CHEQUING.id, CHEQUING]]),
        institutionById: new Map(),
        categories: [MISCELLANEOUS, OTHER_INCOME, DINING],
        currencies: CURRENCIES,
        skippedRowIds: new Set(),
        ruleMatches: new Map([
          [
            rowId,
            {
              merchant: { id: 'm-1', name: 'Cafe', rule: RULE },
              category: { id: DINING.id, name: DINING.name, rule: RULE },
              tags: [{ id: 't-1', name: 'Treat', rule: RULE }],
              tag_count: 1,
            },
          ],
        ]),
      },
      10,
    )

    expect(rows[0].transaction.merchant_name).toBe('Cafe')
    expect(rows[0].category?.id).toBe(DINING.id)
    expect(rows[0].transaction.tags.map((tag) => tag.name)).toEqual(['Treat'])
    expect(rows[1].transaction.merchant_name).toBe('Payroll')
    expect(rows[1].category?.id).toBe(OTHER_INCOME.id)
  })
})
