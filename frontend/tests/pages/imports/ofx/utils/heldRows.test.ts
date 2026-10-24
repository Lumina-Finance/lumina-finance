/**
 * Tests what the OFX preview asks the server about the rows an account may already hold: only rows
 * bound for an account the import can write to and carrying a bank ID are asked, the answer's
 * positions land on the right rows, and the cache key the answer is kept under names no bank value,
 * since the persisted query cache writes keys to browser storage
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { heldBankTransactionKeys } from '@/api/cache/queryKeys'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { OfxFile } from '@/pages/imports/ofx/types'
import { buildOfxHeldCheck, getOfxHeldRowIds } from '@/pages/imports/ofx/utils/heldRows'
import { getOfxSkippedRowId } from '@/pages/imports/ofx/utils/payload'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { buildSgmlOfx, toOfxFile, type FixtureStatement } from './fixtures'

const CHEQUING = { id: 'chequing', name: 'Chequing', currency: 'CAD', can_write: true, is_archived: false, group_id: null } as AccountsOverview
const SAVINGS = { id: 'savings', name: 'Savings', currency: 'CAD', can_write: true, is_archived: false, group_id: null } as AccountsOverview
const ARCHIVED = { ...SAVINGS, id: 'archived', is_archived: true } as AccountsOverview
const SHARED = { ...SAVINGS, id: 'shared', group_id: 'group-1' } as AccountsOverview
const ACCOUNTS = new Map([CHEQUING, SAVINGS, ARCHIVED, SHARED].map((account) => [account.id, account]))

// The bank, account and card numbers and the bank IDs of the statements below
const BANK_VALUES = /123000456|000123456789|4111111111111111|A1|A2|B1/

async function readStatements(statements: FixtureStatement[]): Promise<OfxFile> {
  const read = await readOfxFile(toOfxFile(buildSgmlOfx(statements)))
  if (read.status !== 'read') throw new Error(read.reason)
  return read.file
}

const CHECKING: FixtureStatement = {
  transactions: [
    { fitId: 'A1', name: 'Corner Cafe' },
    { fitId: null, name: 'No bank ID' },
    { fitId: 'A2', name: 'Payroll' },
  ],
}
const CARD: FixtureStatement = { kind: 'creditCard', transactions: [{ fitId: 'B1', name: 'Hardware' }] }

describe('what the preview asks the server about', () => {
  it('asks about each transaction with a bank ID that goes into an existing account, and no other', async () => {
    const file = await readStatements([CHECKING, CARD])
    const [bank, card] = file.statements

    const check = buildOfxHeldCheck(file, ['file-1'], { [bank.id]: CHEQUING.id, [card.id]: CREATE_ACCOUNT_VALUE }, ACCOUNTS)

    expect(check.items).toEqual([
      { account_id: CHEQUING.id, bank_account: bank.id, bank_transaction: 'A1' },
      { account_id: CHEQUING.id, bank_account: bank.id, bank_transaction: 'A2' },
    ])
    expect(check.scope).toEqual({ fileIds: ['file-1'], statements: [[0, CHEQUING.id]] })
  })

  it('asks about nothing while no statement has an account that exists', async () => {
    const file = await readStatements([CHECKING])
    const answers = [{}, { [file.statements[0].id]: CREATE_ACCOUNT_VALUE }, { [file.statements[0].id]: 'deleted' }]

    for (const accountMappings of answers) {
      expect(buildOfxHeldCheck(file, ['file-1'], accountMappings, ACCOUNTS)).toMatchObject({ scope: null, items: [] })
    }
  })

  it.each([ARCHIVED, SHARED])('leaves out an account the import refuses, such as $id, which the server would refuse too', async (account) => {
    const file = await readStatements([CHECKING])

    const check = buildOfxHeldCheck(file, ['file-1'], { [file.statements[0].id]: account.id }, ACCOUNTS)

    expect(check.scope).toBeNull()
  })

  it('names the account each statement goes into, so another account is a different question', async () => {
    const file = await readStatements([CHECKING, CARD])
    const [bank, card] = file.statements

    const check = buildOfxHeldCheck(file, ['file-1'], { [bank.id]: CHEQUING.id, [card.id]: SAVINGS.id }, ACCOUNTS)

    expect(check.scope?.statements).toEqual([[0, CHEQUING.id], [1, SAVINGS.id]])
    expect(check.items.map((item) => item.account_id)).toEqual([CHEQUING.id, CHEQUING.id, SAVINGS.id])
  })

  it('keeps every bank value out of the scope, so the cache key and the persisted cache hold none', async () => {
    const file = await readStatements([CHECKING, CARD])
    const accountMappings = { [file.statements[0].id]: CHEQUING.id, [file.statements[1].id]: SAVINGS.id }

    const check = buildOfxHeldCheck(file, ['file-1'], accountMappings, ACCOUNTS)

    expect(JSON.stringify(check.items)).toMatch(BANK_VALUES)
    expect(JSON.stringify(heldBankTransactionKeys.check(check.scope!))).not.toMatch(BANK_VALUES)
  })
})

describe('reading the answer', () => {
  it('lands each held position on its own transaction, skipping the one with no bank ID', async () => {
    const file = await readStatements([CHECKING])
    const [statement] = file.statements
    const check = buildOfxHeldCheck(file, ['file-1'], { [statement.id]: CHEQUING.id }, ACCOUNTS)

    // Position 1 is the second transaction asked about, which is the third of the statement
    const held = getOfxHeldRowIds(check, [1])

    expect([...held]).toEqual([getOfxSkippedRowId(statement, statement.transactions[2])])
  })
})
