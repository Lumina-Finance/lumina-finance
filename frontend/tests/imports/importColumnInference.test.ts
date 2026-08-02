/**
 * Tests which CSV header the importer guesses for each field, so a column describing the other side of a transfer is not taken by the account or amount columns first
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { inferColumnMap } from '@/pages/imports/utils'

/**
 * Creates a one-file draft from the given headers and rows
 */
function createFile(headers: string[], rows: ImportFileDraft['rows']): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

describe('import column inference', () => {
  it('keeps the account column and the other side of a transfer apart', () => {
    const files = [createFile(
      ['Account', 'Date', 'Amount', 'Category', 'To account'],
      [
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'To account': 'Savings' },
        { Account: 'Chequing', Date: '2026-04-12', Amount: '-12.00', Category: 'Groceries', 'To account': '' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files)

    expect(map.account_id).toBe('Account')
    expect(map.other_account_id).toBe('To account')
  })

  it('reads a column called counterparty as the counterparty account', () => {
    const files = [createFile(
      ['Account', 'Date', 'Amount', 'Category', 'Counterparty account'],
      [
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Counterparty account': 'Savings' },
        { Account: 'Chequing', Date: '2026-04-12', Amount: '-12.00', Category: 'Groceries', 'Counterparty account': '' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files)

    expect(map.account_id).toBe('Account')
    expect(map.other_account_id).toBe('Counterparty account')
  })

  // The account column is barred from these headers, so it leaves them rather than taking one on
  // the weaker match and leaving the counterparty column unmapped
  it('leaves a destination-account column to the counterparty even with no plain account column', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Category', 'Destination account'],
      [
        { Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Destination account': 'Savings' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files)

    expect(map.account_id).toBe('')
    expect(map.other_account_id).toBe('Destination account')
  })

  it('leaves a balance column alone rather than reading it as the amount', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Category', 'Balance'],
      [
        { Date: '2026-04-11', Amount: '-500.00', Category: 'Groceries', Balance: '1200.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files)

    expect(map.amount).toBe('Amount')
    expect(Object.values(map)).not.toContain('Balance')
  })
})
