/**
 * Tests that the Firefly III commit refuses an account archived after it was chosen, the same way
 * the generic CSV commit does, rather than sending the id and failing at the server part way through
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { buildFireflyImportPayload } from '@/pages/imports/firefly/utils'

const CHEQUING = { id: 'chequing', name: 'Chequing', is_archived: false } as AccountsOverview
const ARCHIVED = { id: 'old-savings', name: 'Old Savings', is_archived: true } as AccountsOverview

const ROW: CsvRow = {
  journal_id: '1',
  type: 'Withdrawal',
  date: '2026-06-11 00:00:00',
  amount: '-12.34',
  currency_code: 'CAD',
  foreign_amount: '',
  foreign_currency_code: '',
  description: 'Weekly shop',
  source_name: 'Chequing',
  source_type: 'Asset account',
  destination_name: 'Market',
  destination_type: 'Expense account',
  category: 'Groceries',
  tags: '',
  notes: '',
}

const TRANSACTIONS_FILE = {
  id: 'firefly',
  name: 'transactions.csv',
  size: 128,
  headers: Object.keys(ROW),
  rows: [ROW],
  hasHeaderRow: true,
} as ImportFileDraft

/**
 * Builds the payload for one tracked account mapped to the given account id
 */
function buildWithMapping(accountId: string, accounts: AccountsOverview[]) {
  return buildFireflyImportPayload({
    transactionsFile: TRANSACTIONS_FILE,
    rows: [ROW],
    trackedAccountNames: ['Chequing'],
    accountMappings: { Chequing: accountId },
    accountById: new Map(accounts.map((account) => [account.id, account])),
    accountCreateDetails: {},
    importedCategories: ['Groceries'],
    categoryMappings: { Groceries: 'groceries' },
    categoryCreateKinds: {},
  })
}

describe('a Firefly account archived after it was mapped', () => {
  it('refuses the commit and says which source', () => {
    const result = buildWithMapping(ARCHIVED.id, [CHEQUING, ARCHIVED])

    expect(result.payload).toBeNull()
    expect(result.errors).toContain('Rows cannot be written to an archived account: Chequing')
  })

  it('accepts the same mapping while the account is not archived', () => {
    const result = buildWithMapping(CHEQUING.id, [CHEQUING, ARCHIVED])

    expect(result.errors).not.toContain('Rows cannot be written to an archived account: Chequing')
    expect(result.payload?.accounts).toEqual([{ source: 'Chequing', account_id: CHEQUING.id }])
  })
})
